/**
 * Result explícito para regras de domínio: evita usar exceções para fluxo esperado
 * (ex.: validação de cadastro). Exceções ficam reservadas para falhas inesperadas
 * e para falhas de integração (ver IntegrationError).
 */
export type Result<T, E = DomainError> = Ok<T> | Fail<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Fail<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const fail = <E>(error: E): Fail<E> => ({ ok: false, error });

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super("VALIDATION_ERROR", message, { fieldErrors });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string | number) {
    super("NOT_FOUND", `${entity} não encontrado(a): ${id}`, { entity, id });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, details);
    this.name = "ConflictError";
  }
}

/** Sem identificação válida (sessão ausente, expirada ou credenciais erradas): HTTP 401. */
export class UnauthorizedError extends DomainError {
  constructor(message = "Faça login para continuar.", code = "UNAUTHENTICATED") {
    super(code, message);
    this.name = "UnauthorizedError";
  }
}

/** Identificado, mas sem permissão para a ação: HTTP 403. */
export class ForbiddenError extends DomainError {
  constructor(message = "Você não tem permissão para esta ação.", code = "FORBIDDEN") {
    super(code, message);
    this.name = "ForbiddenError";
  }
}

/** Tentativas demais (ex.: login bloqueado por senha errada repetida): HTTP 429. */
export class TooManyRequestsError extends DomainError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super("TOO_MANY_ATTEMPTS", message, { retryAfterSeconds });
    this.name = "TooManyRequestsError";
  }
}

const DOMAIN_ERROR_NAMES = new Set(["DomainError", "ValidationError", "NotFoundError", "ConflictError", "UnauthorizedError", "ForbiddenError", "TooManyRequestsError"]);

/**
 * Reconhece um erro de domínio pelo nome, não só por `instanceof`. No build do Next o container nasce no
 * `instrumentation` (outro bundle, outra cópia destas classes), então um NotFoundError lançado por um
 * serviço não é `instanceof` do NotFoundError importado pela rota.
 */
export function domainErrorName(error: unknown): string | null {
  if (!(error instanceof Error) || typeof (error as { code?: unknown }).code !== "string") return null;
  if (error instanceof DomainError) return error.name;
  return DOMAIN_ERROR_NAMES.has(error.name) ? error.name : null;
}

export function isDomainError(error: unknown): error is DomainError {
  return domainErrorName(error) !== null;
}
