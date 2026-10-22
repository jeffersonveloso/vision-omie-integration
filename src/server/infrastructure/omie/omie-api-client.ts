import type { CallRecorder, OmieCredentials } from "@/server/modules/integration/application/ports";
import { IntegrationError } from "@/server/modules/integration/domain/integration-error";
import { describeNetworkError, isAbortOrNetworkError, readBody, sleep } from "../http/json-http";
import { classifyFault, type OmieFaultKind, readFault, toIntegrationError } from "./omie-error-classifier";
import type { OmieRateLimiter } from "./omie-rate-limiter";

export interface OmieClientConfig {
  baseUrl: string;
  timeoutMs: number;
  maxInlineRetries: number;
  /** Cache de leituras idênticas (padrão 55 s; 0 desliga). */
  readCacheTtlMs?: number;
}

/** Erro do Omie com o tipo de falha, para o gateway tratar casos esperados (ex.: "não encontrado"). */
export class OmieCallError extends Error {
  constructor(
    readonly kind: OmieFaultKind,
    readonly integrationError: IntegrationError,
  ) {
    super(integrationError.message);
    this.name = "OmieCallError";
  }
}

const WRITE_METHOD = /^(Incluir|Alterar|Upsert|Excluir|Lancar|Cancelar|Trocar|Faturar|Associar)/;

/** Cache curto de leituras idênticas: evita o bloqueio do Omie para consulta repetida em < 60 s. */
class ReadCache {
  private entries = new Map<string, { at: number; value: unknown }>();

  get(key: string, ttlMs: number): unknown | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: unknown): void {
    if (this.entries.size > 2000) this.entries.clear();
    this.entries.set(key, { at: Date.now(), value });
  }

  invalidate(prefix: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }
}

const sharedReadCache = new ReadCache();

/**
 * Cliente JSON da API Omie: POST {call, app_key, app_secret, param:[...]} em /api/v1/{serviço}/.
 * Credenciais nunca são registradas em log.
 */
export class OmieApiClient {
  constructor(
    private readonly config: OmieClientConfig,
    private readonly limiter: OmieRateLimiter,
    private readonly credentials: OmieCredentials,
    private readonly recorder?: CallRecorder,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T = Record<string, unknown>>(service: string, method: string, param: Record<string, unknown>, options: { cache?: boolean } = {}): Promise<T> {
    const write = WRITE_METHOD.test(method);
    const ttl = this.config.readCacheTtlMs ?? 55_000;
    const useCache = !write && options.cache !== false && ttl > 0;
    const cacheKey = `${this.credentials.appKey}|${service}|${method}|${JSON.stringify(param)}`;
    if (useCache) {
      const cached = sharedReadCache.get(cacheKey, ttl);
      if (cached !== undefined) return cached as T;
    }
    if (write) sharedReadCache.invalidate(`${this.credentials.appKey}|${service}|`);

    const operation = `${service} › ${method}`;
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      let httpStatus = 0;
      let body: unknown;
      try {
        const response = await this.limiter.schedule(this.credentials.appKey, method, write, () =>
          this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, "")}/${service}/`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ call: method, app_key: this.credentials.appKey, app_secret: this.credentials.appSecret, param: [param] }),
            signal: AbortSignal.timeout(this.config.timeoutMs),
          }),
        );
        httpStatus = response.status;
        body = await readBody(response);
      } catch (error) {
        const retryable = isAbortOrNetworkError(error);
        this.recorder?.({ system: "OMIE", operation, request: { call: method, param }, error: describeNetworkError(error), durationMs: Date.now() - started, ok: false });
        if (retryable && attempt < this.config.maxInlineRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new OmieCallError(
          "UNAVAILABLE",
          new IntegrationError({
            category: "OMIE_UNAVAILABLE",
            code: "NETWORK",
            message: `Falha de comunicação com o Omie (${operation}): ${describeNetworkError(error)}.`,
            hint: "Falha temporária. Nova tentativa automática agendada (sem risco de duplicidade).",
            retryable: true,
          }),
        );
      }

      const fault = readFault(httpStatus, body);
      const durationMs = Date.now() - started;
      if (!fault) {
        this.recorder?.({ system: "OMIE", operation, request: { call: method, param }, response: body, httpStatus, durationMs, ok: true });
        if (useCache) sharedReadCache.set(cacheKey, body);
        return body as T;
      }

      const kind = classifyFault(fault);
      const expected = kind === "EMPTY_LIST" || kind === "NOT_FOUND";
      const label = expected && !write ? `${operation} (${kind === "EMPTY_LIST" ? "nenhum registro" : "não existe no Omie"})` : operation;
      this.recorder?.({ system: "OMIE", operation: label, request: { call: method, param }, response: body, httpStatus, durationMs, ok: expected && !write });
      if ((kind === "RATE_LIMIT" || kind === "UNAVAILABLE") && attempt < this.config.maxInlineRetries) {
        await sleep(kind === "RATE_LIMIT" ? 2000 * 2 ** attempt : 1500 * 2 ** attempt);
        continue;
      }
      throw new OmieCallError(kind, toIntegrationError(fault, kind, { service, method }));
    }
  }
}
