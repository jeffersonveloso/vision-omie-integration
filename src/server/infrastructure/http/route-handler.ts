import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type AppContainer, getContainer } from "@/server/container";
import type { AuditContext } from "@/server/modules/audit/domain/audit-event";
import type { AppLogger } from "@/server/shared/application/ports";
import { ConsoleLogger } from "@/server/shared/infrastructure/console-logger";
import { env } from "@/server/shared/infrastructure/env";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/server/shared/domain/result";
import { ERROR_CATEGORY_LABELS, IntegrationError } from "@/server/modules/integration/domain/integration-error";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
    category?: string;
    categoryLabel?: string;
    hint?: string | null;
    requestId?: string;
  };
}

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

/** Contexto de cada requisição: identificador (correlação nos logs), autor e IP — vai para a auditoria. */
export interface RequestMeta extends AuditContext {
  requestId: string;
  method: string;
  path: string;
}

/** Cabeçalhos que proxies de autenticação costumam preencher (oauth2-proxy, Cloudflare Access, Apache/Nginx). */
const ACTOR_HEADERS = ["x-forwarded-email", "x-auth-request-email", "x-forwarded-user", "x-auth-request-user", "x-remote-user", "remote-user", "cf-access-authenticated-user-email"];

export function requestMeta(request: Request): RequestMeta {
  const incoming = request.headers.get("x-request-id")?.trim();
  const configured = env().AUTH_USER_HEADER;
  const actorHeader = configured ? [configured] : ACTOR_HEADERS;
  const actor = actorHeader.map((h) => request.headers.get(h)?.trim()).find(Boolean) ?? null;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const url = new URL(request.url);
  return {
    requestId: incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID(),
    actor: actor ? actor.slice(0, 200) : null,
    ip: forwarded || request.headers.get("x-real-ip") || null,
    method: request.method,
    path: url.pathname,
  };
}

const fallbackLogger = new ConsoleLogger("http");

function errorResponse(error: unknown, meta: RequestMeta, logger: AppLogger): Response {
  if (error instanceof ValidationError) {
    return json<ApiErrorBody>({ error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors } }, { status: 422 });
  }
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) fieldErrors[issue.path.join(".")] = issue.message;
    return json<ApiErrorBody>({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", fieldErrors } }, { status: 422 });
  }
  if (error instanceof NotFoundError) return json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, { status: 404 });
  if (error instanceof ConflictError) return json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, { status: 409 });
  if (error instanceof DomainError) return json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, { status: 400 });
  if (error instanceof IntegrationError) {
    logger.warn("Falha de integração ao atender requisição", { requestId: meta.requestId, method: meta.method, path: meta.path, code: error.code, category: error.category, message: error.message });
    return json<ApiErrorBody>(
      { error: { code: error.code, message: error.message, category: error.category, categoryLabel: ERROR_CATEGORY_LABELS[error.category], hint: error.hint } },
      { status: 502 },
    );
  }
  logger.error("Erro inesperado na API", {
    requestId: meta.requestId,
    method: meta.method,
    path: meta.path,
    actor: meta.actor,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return json<ApiErrorBody>(
    { error: { code: "INTERNAL", message: `Erro interno ao processar a requisição. Informe o código ${meta.requestId} ao suporte.`, requestId: meta.requestId } },
    { status: 500 },
  );
}

/**
 * Envolve um route handler: injeta o container e o contexto da requisição, converte erros de domínio em
 * respostas HTTP e devolve o cabeçalho `x-request-id` (o mesmo código aparece nos logs e na auditoria).
 */
export function handler<Ctx = unknown>(fn: (request: Request, container: AppContainer, ctx: Ctx, meta: RequestMeta) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    const meta = requestMeta(request);
    let container: AppContainer | null = null;
    let response: Response;
    try {
      container = await getContainer();
      response = await fn(request, container, ctx, meta);
    } catch (error) {
      response = errorResponse(error, meta, container?.logger ?? fallbackLogger);
    }
    response.headers.set("x-request-id", meta.requestId);
    return response;
  };
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Corpo da requisição não é um JSON válido.");
  }
  return schema.parse(body);
}
