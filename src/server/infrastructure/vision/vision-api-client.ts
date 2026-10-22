import type {
  CallRecorder,
  VisionAuthorizationPayload,
  VisionCancellationPayload,
  VisionGateway,
  VisionListQuery,
  VisionPaymentCancellationPayload,
  VisionPaymentPayload,
  VisionRejectionPayload,
} from "@/server/modules/integration/application/ports";
import { IntegrationError } from "@/server/modules/integration/domain/integration-error";
import { parseVisionOrderSummary, type VisionOrderPayload, type VisionOrderSummary } from "@/server/modules/integration/domain/vision-order";
import { describeNetworkError, isAbortOrNetworkError, readBody } from "../http/json-http";

export interface VisionClientConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
}

/** Usado só quando o token não traz a validade (o JWT do Vision traz: 120 min). */
const TOKEN_FALLBACK_TTL_MS = 115 * 60_000;
const TOKEN_RENEW_MARGIN_MS = 5 * 60_000;
const ENVELOPE_KEYS = ["pedidos", "Pedidos", "dados", "Dados", "data", "itens", "items", "registros", "lista", "resultado", "result", "value", "Value"];

function extractArray(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ENVELOPE_KEYS) if (Array.isArray(obj[key])) return extractArray(obj[key]);
    const firstArray = Object.values(obj).find(Array.isArray);
    if (firstArray) return extractArray(firstArray);
  }
  return [];
}

function extractOrder(body: unknown): VisionOrderPayload | null {
  if (Array.isArray(body)) return (body[0] as VisionOrderPayload) ?? null;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if ("itens" in obj || "servicos" in obj || "codigo" in obj || "cliente" in obj) return obj as VisionOrderPayload;
    for (const key of ["pedido", "Pedido", ...ENVELOPE_KEYS]) {
      const inner = obj[key];
      if (inner && typeof inner === "object") return extractOrder(inner);
    }
  }
  return null;
}

/**
 * O login da ControllerAPI devolve o JWT como string JSON: "eyJhbGciOiJIUzI1NiIs...".
 * Os demais formatos ficam aceitos caso a API mude.
 */
export function extractToken(body: unknown): string | null {
  if (typeof body === "string" && body.trim()) return body.trim().replace(/^"|"$/g, "").replace(/^Bearer\s+/i, "");
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["token", "Token", "access_token", "accessToken", "autenticacao", "Autenticacao", "bearer", "jwt"]) {
      if (typeof obj[key] === "string" && (obj[key] as string).trim()) return (obj[key] as string).trim().replace(/^Bearer\s+/i, "");
    }
    for (const key of ["dados", "data", "usuario", "Usuario", "result"]) if (obj[key]) return extractToken(obj[key]);
  }
  return null;
}

/**
 * Até quando reutilizar o token. Usa a duração do JWT (exp − iat) contada a partir do relógio local,
 * então diferença de horário entre os servidores não faz o token "vencer" antes nem depois da hora.
 */
export function tokenReuseUntil(token: string, now: number): number {
  const payload = token.split(".")[1];
  if (payload) {
    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown; iat?: unknown };
      if (typeof claims.exp === "number") {
        const lifetimeMs = typeof claims.iat === "number" ? (claims.exp - claims.iat) * 1000 : claims.exp * 1000 - now;
        if (lifetimeMs > 0) return now + Math.max(lifetimeMs - TOKEN_RENEW_MARGIN_MS, lifetimeMs / 2);
      }
    } catch {
      // não é um JWT legível: usa a validade padrão
    }
  }
  return now + TOKEN_FALLBACK_TTL_MS;
}

function visionMessage(body: unknown): string | null {
  if (typeof body === "string") return body.slice(0, 500);
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const msg = obj.ExceptionMessage ?? obj.Message ?? obj.message ?? obj.mensagem ?? obj.Mensagem ?? obj.erro ?? obj.error;
    return msg ? String(msg) : null;
  }
  return null;
}

/**
 * Adaptador da ControllerAPI do Vision (Swagger v1).
 * Autenticação: POST /api/login → JWT (string JSON, 120 min), renovado 5 min antes de vencer
 * e refeito uma vez se a API responder 401.
 */
export class VisionApiClient implements VisionGateway {
  private token: { value: string; expiresAt: number } | null = null;
  private loginInFlight: Promise<string> | null = null;

  constructor(
    private readonly config: VisionClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string, query?: Record<string, string | number | null | undefined>): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    return `${base}${path}${qs ? `?${qs}` : ""}`;
  }

  private async login(): Promise<string> {
    if (!this.config.username) {
      throw new IntegrationError({ category: "VISION_AUTH", code: "NO_CREDENTIALS", message: "Credenciais do Vision não configuradas.", hint: "Defina VISION_USERNAME e VISION_PASSWORD nas variáveis de ambiente.", retryable: false });
    }
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(this.url("/api/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ usuario: this.config.username, senha: this.config.password }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw this.networkError(error, "login");
    }
    const body = await readBody(response);
    const token = response.ok ? extractToken(body) : null;
    if (!token) {
      throw new IntegrationError({
        category: "VISION_AUTH",
        code: `LOGIN_${response.status}`,
        message: `Falha no login da ControllerAPI do Vision (HTTP ${response.status}${visionMessage(body) ? `: ${visionMessage(body)}` : ""}).`,
        hint: "Confira usuário e senha (VISION_USERNAME / VISION_PASSWORD) e se o usuário está ativo no Vision.",
        retryable: response.status >= 500,
        details: { httpStatus: response.status, durationMs: Date.now() - started },
      });
    }
    this.token = { value: token, expiresAt: tokenReuseUntil(token, Date.now()) };
    return token;
  }

  private async getToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (!this.loginInFlight) this.loginInFlight = this.login().finally(() => (this.loginInFlight = null));
    return this.loginInFlight;
  }

  private networkError(error: unknown, operation: string): IntegrationError {
    return new IntegrationError({
      category: "VISION_UNAVAILABLE",
      code: "NETWORK",
      message: `Não foi possível comunicar com a ControllerAPI do Vision (${operation}): ${describeNetworkError(error)}.`,
      hint: `Verifique se ${this.config.baseUrl} está acessível a partir do servidor da integração. Nova tentativa automática agendada.`,
      retryable: true,
    });
  }

  private async request(method: "GET" | "POST", path: string, opts: { query?: Record<string, string | number | null | undefined>; body?: unknown; recorder?: CallRecorder; operation: string }): Promise<unknown> {
    const execute = async (forceToken: boolean) => {
      const token = await this.getToken(forceToken);
      const started = Date.now();
      try {
        const response = await this.fetchImpl(this.url(path, opts.query), {
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        const body = await readBody(response);
        return { response, body, durationMs: Date.now() - started };
      } catch (error) {
        opts.recorder?.({ system: "VISION", operation: opts.operation, request: { query: opts.query, body: opts.body }, error: describeNetworkError(error), durationMs: Date.now() - started, ok: false });
        throw this.networkError(error, opts.operation);
      }
    };

    let result = await execute(false);
    if (result.response.status === 401) result = await execute(true);
    const { response, body, durationMs } = result;
    opts.recorder?.({ system: "VISION", operation: opts.operation, request: { query: opts.query, body: opts.body }, response: body, httpStatus: response.status, durationMs, ok: response.ok });
    if (response.ok) return body;

    const message = visionMessage(body);
    if (response.status === 401 || response.status === 403) {
      throw new IntegrationError({ category: "VISION_AUTH", code: `HTTP_${response.status}`, message: `Acesso negado pela ControllerAPI do Vision (${opts.operation}).`, hint: "Confira as permissões do usuário de integração no Vision.", retryable: true, details: { httpStatus: response.status, body } });
    }
    if (response.status >= 500 || response.status === 429) {
      throw new IntegrationError({ category: "VISION_UNAVAILABLE", code: `HTTP_${response.status}`, message: `A ControllerAPI do Vision respondeu com erro ${response.status}${message ? `: ${message}` : ""}.`, hint: "Falha temporária do Vision. Nova tentativa automática agendada.", retryable: true, details: { httpStatus: response.status, body } });
    }
    throw new IntegrationError({
      category: "VISION_BUSINESS",
      code: `HTTP_${response.status}`,
      message: `O Vision recusou a requisição (${opts.operation}): ${message ?? `HTTP ${response.status}`}.`,
      hint: "Verifique a mensagem do Vision e os dados enviados (aba Linha do tempo › detalhes da chamada).",
      retryable: false,
      details: { httpStatus: response.status, body },
    });
  }

  async listUpdatedOrders(query: VisionListQuery, recorder?: CallRecorder): Promise<VisionOrderSummary[]> {
    const body = await this.request("GET", "/api/pedido/busca/atualizados", {
      query: { dataInicial: query.dataInicial, dataFinal: query.dataFinal, codigoStatus: query.codigoStatus ?? undefined, pagina: query.pagina, linhas: query.linhas },
      recorder,
      operation: `GET /api/pedido/busca/atualizados (página ${query.pagina})`,
    });
    return extractArray(body).map(parseVisionOrderSummary).filter((s): s is VisionOrderSummary => s !== null);
  }

  async getOrder(code: number, recorder?: CallRecorder): Promise<VisionOrderPayload> {
    const body = await this.request("GET", `/api/pedido/busca/${code}`, { recorder, operation: `GET /api/pedido/busca/${code}` });
    const order = extractOrder(body);
    if (!order) {
      throw new IntegrationError({ category: "VISION_BUSINESS", code: "ORDER_NOT_FOUND", message: `O Vision não retornou os dados do pedido ${code}.`, hint: "Confirme se o pedido existe e está disponível para integração.", retryable: true, details: { body } });
    }
    return order;
  }

  sendInvoiceAuthorization(payload: VisionAuthorizationPayload, recorder?: CallRecorder) {
    return this.request("POST", "/api/pedido/nota/autorizacao", { body: payload, recorder, operation: "POST /api/pedido/nota/autorizacao" });
  }

  sendInvoiceRejection(payload: VisionRejectionPayload, recorder?: CallRecorder) {
    return this.request("POST", "/api/pedido/nota/rejeicao", { body: payload, recorder, operation: "POST /api/pedido/nota/rejeicao" });
  }

  sendInvoiceCancellation(payload: VisionCancellationPayload, recorder?: CallRecorder) {
    return this.request("POST", "/api/pedido/nota/cancelamento", { body: payload, recorder, operation: "POST /api/pedido/nota/cancelamento" });
  }

  sendParcelPayment(payload: VisionPaymentPayload, recorder?: CallRecorder) {
    return this.request("POST", "/api/pedido/parcela/baixa", { body: payload, recorder, operation: "POST /api/pedido/parcela/baixa" });
  }

  cancelParcelPayment(payload: VisionPaymentCancellationPayload, recorder?: CallRecorder) {
    return this.request("POST", "/api/pedido/parcela/baixa/cancelar", { body: payload, recorder, operation: "POST /api/pedido/parcela/baixa/cancelar" });
  }

  async testConnection(): Promise<{ message: string }> {
    this.token = null;
    await this.getToken(true);
    return { message: `Login na ControllerAPI realizado com sucesso (${this.config.baseUrl}).` };
  }
}
