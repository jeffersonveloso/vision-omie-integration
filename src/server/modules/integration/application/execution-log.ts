import type { Clock } from "@/server/shared/application/ports";
import type { IntegrationStep } from "../domain/integration-error";
import type { IntegrationLogEntry, IntegrationLogRepository, LogLevel } from "../domain/repositories";
import type { CallRecorder, ExternalCallRecord } from "./ports";

const MAX_STRING = 8_000;
const SECRET_KEYS = /^(app_secret|appSecret|app_key|appKey|senha|password|authorization|token)$/i;

/** Remove segredos e encurta textos enormes (XML/PDF em base64) antes de gravar o log. */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[…]";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, 400)}… [${value.length} caracteres omitidos]` : value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 200).map((v) => sanitizeForLog(v, depth + 1));
    return value.length > 200 ? [...items, `… +${value.length - 200} itens`] : items;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[oculto]" : sanitizeForLog(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Coletor de eventos de uma execução (um pedido ou uma rotina).
 * Cada chamada externa é registrada com request/response, o que permite
 * rastrear exatamente onde e por que um pedido falhou.
 */
export class ExecutionLog {
  private entries: IntegrationLogEntry[] = [];
  currentStep: IntegrationStep | null = null;

  constructor(
    private readonly scope: { orderId: string | null; runId: string | null },
    private readonly clock: Clock,
  ) {}

  step(step: IntegrationStep): this {
    this.currentStep = step;
    return this;
  }

  add(level: LogLevel, message: string, data?: Record<string, unknown> | null, step?: IntegrationStep | null): void {
    this.entries.push({
      orderId: this.scope.orderId,
      runId: this.scope.runId,
      level,
      step: step ?? this.currentStep,
      message,
      data: data ? (sanitizeForLog(data) as Record<string, unknown>) : null,
      createdAt: this.clock.now(),
    });
  }

  info(message: string, data?: Record<string, unknown> | null): void {
    this.add("INFO", message, data);
  }

  warn(message: string, data?: Record<string, unknown> | null): void {
    this.add("WARN", message, data);
  }

  error(message: string, data?: Record<string, unknown> | null): void {
    this.add("ERROR", message, data);
  }

  recorder(): CallRecorder {
    return (record: ExternalCallRecord) => {
      this.add(record.ok ? "INFO" : "ERROR", `${record.system === "OMIE" ? "Omie" : "Vision"} · ${record.operation}`, {
        kind: "external-call",
        system: record.system,
        operation: record.operation,
        httpStatus: record.httpStatus ?? null,
        durationMs: record.durationMs,
        request: record.request,
        response: record.response ?? null,
        error: record.error ?? null,
      });
    };
  }

  get size(): number {
    return this.entries.length;
  }

  async flush(repository: IntegrationLogRepository): Promise<void> {
    if (this.entries.length === 0) return;
    const batch = this.entries;
    this.entries = [];
    await repository.append(batch);
  }
}
