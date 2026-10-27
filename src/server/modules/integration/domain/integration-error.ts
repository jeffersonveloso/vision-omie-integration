/**
 * Erro de integração classificado. É o que aparece para o usuário na plataforma:
 * categoria + mensagem clara + dica de correção + dados técnicos (request/response).
 */

export const ERROR_CATEGORIES = [
  "ROUTING",
  "MAPPING",
  "VALIDATION",
  "OMIE_BUSINESS",
  "OMIE_AUTH",
  "OMIE_RATE_LIMIT",
  "OMIE_UNAVAILABLE",
  "VISION_BUSINESS",
  "VISION_AUTH",
  "VISION_UNAVAILABLE",
  "INTERNAL",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  ROUTING: "Roteamento para a conta Omie",
  MAPPING: "Mapeamento de dados",
  VALIDATION: "Dados do pedido",
  OMIE_BUSINESS: "Recusado pelo Omie",
  OMIE_AUTH: "Credenciais do Omie",
  OMIE_RATE_LIMIT: "Limite de consumo do Omie",
  OMIE_UNAVAILABLE: "Omie indisponível",
  VISION_BUSINESS: "Recusado pelo Vision",
  VISION_AUTH: "Autenticação no Vision",
  VISION_UNAVAILABLE: "Vision indisponível",
  INTERNAL: "Erro interno",
};

export const INTEGRATION_STEPS = [
  "COLLECT",
  "FETCH_DETAIL",
  "ROUTE",
  "MAP",
  "CUSTOMER_SYNC",
  "SEND_SALES_ORDER",
  "SEND_SERVICE_ORDER",
  "CHECK_FISCAL",
  "RETURN_FISCAL",
  "CHECK_FINANCIAL",
  "RETURN_FINANCIAL",
] as const;
export type IntegrationStep = (typeof INTEGRATION_STEPS)[number];

export const INTEGRATION_STEP_LABELS: Record<IntegrationStep, string> = {
  COLLECT: "Coleta no Vision",
  FETCH_DETAIL: "Consulta do pedido completo",
  ROUTE: "Roteamento",
  MAP: "Mapeamento",
  CUSTOMER_SYNC: "Sincronização do cliente",
  SEND_SALES_ORDER: "Envio do pedido de venda",
  SEND_SERVICE_ORDER: "Envio da ordem de serviço",
  CHECK_FISCAL: "Consulta fiscal no Omie",
  RETURN_FISCAL: "Retorno fiscal ao Vision",
  CHECK_FINANCIAL: "Consulta financeira no Omie",
  RETURN_FINANCIAL: "Retorno financeiro ao Vision",
};

/** Etapas que pertencem ao fluxo de retorno (Omie → Vision). */
export const RETURN_STEPS: IntegrationStep[] = ["CHECK_FISCAL", "RETURN_FISCAL", "CHECK_FINANCIAL", "RETURN_FINANCIAL"];

export interface StoredError {
  category: ErrorCategory;
  code: string;
  message: string;
  hint: string | null;
  retryable: boolean;
  step: IntegrationStep | null;
  details: Record<string, unknown> | null;
  occurredAt: string;
}

export interface IntegrationErrorInit {
  category: ErrorCategory;
  code: string;
  message: string;
  hint?: string | null;
  retryable?: boolean;
  step?: IntegrationStep | null;
  details?: Record<string, unknown> | null;
  /** Para limites de consumo: tempo mínimo até a próxima tentativa. */
  retryAfterMs?: number | null;
}

export class IntegrationError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly hint: string | null;
  readonly retryable: boolean;
  step: IntegrationStep | null;
  readonly details: Record<string, unknown> | null;
  readonly retryAfterMs: number | null;

  constructor(init: IntegrationErrorInit) {
    super(init.message);
    this.name = "IntegrationError";
    this.category = init.category;
    this.code = init.code;
    this.hint = init.hint ?? null;
    this.retryable = init.retryable ?? false;
    this.step = init.step ?? null;
    this.details = init.details ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
  }

  withStep(step: IntegrationStep): this {
    if (!this.step) this.step = step;
    return this;
  }

  toStored(now: Date): StoredError {
    return {
      category: this.category,
      code: this.code,
      message: this.message,
      hint: this.hint,
      retryable: this.retryable,
      step: this.step,
      details: this.details,
      occurredAt: now.toISOString(),
    };
  }

  static from(error: unknown, step: IntegrationStep): IntegrationError {
    if (error instanceof IntegrationError) return error.withStep(step);
    const message = error instanceof Error ? error.message : String(error);
    return new IntegrationError({
      category: "INTERNAL",
      code: "UNEXPECTED",
      message: `Erro inesperado: ${message}`,
      hint: "Tente reenviar. Se persistir, verifique os logs técnicos abaixo.",
      retryable: true,
      step,
      details: error instanceof Error ? { stack: error.stack?.split("\n").slice(0, 6).join("\n") } : null,
    });
  }
}

/** Reconhece pelo nome também: o erro pode vir de outro bundle (veja `domainErrorName`). */
export function isIntegrationError(error: unknown): error is IntegrationError {
  return error instanceof IntegrationError || (error instanceof Error && error.name === "IntegrationError" && typeof (error as IntegrationError).category === "string");
}
