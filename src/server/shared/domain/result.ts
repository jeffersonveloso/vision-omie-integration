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
