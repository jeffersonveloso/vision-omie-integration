import "server-only";
import { z } from "zod";
import { type AppContainer, getContainer } from "@/server/container";
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
  };
}

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function errorResponse(error: unknown): Response {
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
    return json<ApiErrorBody>(
      { error: { code: error.code, message: error.message, category: error.category, categoryLabel: ERROR_CATEGORY_LABELS[error.category], hint: error.hint } },
      { status: 502 },
    );
  }
  console.error(error);
  return json<ApiErrorBody>({ error: { code: "INTERNAL", message: error instanceof Error ? error.message : "Erro interno." } }, { status: 500 });
}

/** Envolve um route handler: injeta o container e converte erros de domínio em respostas HTTP. */
export function handler<Ctx = unknown>(fn: (request: Request, container: AppContainer, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      const container = await getContainer();
      return await fn(request, container, ctx);
    } catch (error) {
      return errorResponse(error);
    }
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
