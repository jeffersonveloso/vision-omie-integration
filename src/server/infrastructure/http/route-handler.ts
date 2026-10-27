import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { type AppContainer, getContainer } from "@/server/container";
import type { AuditContext } from "@/server/modules/audit/domain/audit-event";
import type { AppLogger } from "@/server/shared/application/ports";
import { ConsoleLogger } from "@/server/shared/infrastructure/console-logger";
import { env } from "@/server/shared/infrastructure/env";
import { type DomainError, domainErrorName, ForbiddenError, UnauthorizedError, ValidationError } from "@/server/shared/domain/result";
import type { UserRole } from "@/server/modules/identity/domain/user";
import { clearSessionCookie, isHttpsRequest, readCookie, SESSION_COOKIE } from "./auth-cookie";
import { ERROR_CATEGORY_LABELS, isIntegrationError } from "@/server/modules/integration/domain/integration-error";

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

/** Quem está chamando a API. */
export interface AuthUser {
  /** Id do usuário (login próprio); null para token de API e proxy. */
  id: string | null;
  email: string | null;
  name: string;
  /** ADMIN/OPERATOR (login próprio), API (token) ou PROXY (identidade do proxy autenticado). */
  role: UserRole | "API" | "PROXY";
  via: "session" | "token" | "proxy";
  mustChangePassword: boolean;
  sessionId: string | null;
}

/** Contexto de cada requisição: identificador (correlação nos logs), autor e IP — vai para a auditoria. */
export interface RequestMeta extends AuditContext {
  requestId: string;
  method: string;
  path: string;
  userAgent: string | null;
  user: AuthUser | null;
}

/**
 * Quem pode chamar a rota (com AUTH_MODE=local; com `proxy` quem protege é o proxy):
 * - `user` (padrão): qualquer usuário logado ou o token de API;
 * - `admin`: só administradores;
 * - `password-change`: logado, mesmo com troca de senha pendente (rotas da própria conta);
 * - `public`: sem login (login, health, webhook com token próprio).
 */
export type RouteAccess = "user" | "admin" | "password-change" | "public";

/** Cabeçalhos que proxies de autenticação costumam preencher (oauth2-proxy, Cloudflare Access, Apache/Nginx). */
const ACTOR_HEADERS = ["x-forwarded-email", "x-auth-request-email", "x-forwarded-user", "x-auth-request-user", "x-remote-user", "remote-user", "cf-access-authenticated-user-email"];

export function requestMeta(request: Request): RequestMeta {
  const incoming = request.headers.get("x-request-id")?.trim();
  const config = env();
  // O cabeçalho do proxy só vale com AUTH_MODE=proxy: no login próprio qualquer um poderia forjá-lo.
  const actorHeader = config.AUTH_MODE !== "proxy" ? [] : config.AUTH_USER_HEADER ? [config.AUTH_USER_HEADER] : ACTOR_HEADERS;
  const actor = actorHeader.map((h) => request.headers.get(h)?.trim()).find(Boolean) ?? null;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const url = new URL(request.url);
  return {
    requestId: incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID(),
    actor: actor ? actor.slice(0, 200) : null,
    ip: forwarded || request.headers.get("x-real-ip") || null,
    method: request.method,
    path: url.pathname,
    userAgent: request.headers.get("user-agent"),
    user: actor ? { id: null, email: actor.slice(0, 200), name: actor.slice(0, 200), role: "PROXY", via: "proxy", mustChangePassword: false, sessionId: null } : null,
  };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

function tokenMatches(given: string, expected: string | undefined): boolean {
  if (!expected || expected.length < 32) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Identifica quem chama (sessão do login próprio ou token de API) e aplica a regra de acesso da rota.
 * Com AUTH_MODE=proxy não faz nada: o proxy autenticado já barrou quem não pode entrar.
 */
async function authorize(request: Request, container: AppContainer, meta: RequestMeta, access: RouteAccess): Promise<void> {
  const config = env();
  if (config.AUTH_MODE === "proxy") return;

  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    if (!tokenMatches(authorization.slice(7).trim(), config.AUTH_API_TOKEN)) throw new UnauthorizedError("Token de API inválido.", "INVALID_TOKEN");
    meta.user = { id: null, email: null, name: "Token de API", role: "API", via: "token", mustChangePassword: false, sessionId: null };
    meta.actor = "token de API";
  } else {
    const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
    const found = token ? await container.auth.authenticate(token) : null;
    if (found) {
      const { user, session } = found;
      meta.user = { id: user.id, email: user.email, name: user.name, role: user.role, via: "session", mustChangePassword: user.mustChangePassword, sessionId: session.id };
      meta.actor = user.email;
      // SameSite=Lax já bloqueia o cookie em POST vindo de outro site; isto cobre navegadores antigos.
      if (!SAFE_METHODS.has(request.method) && request.headers.get("sec-fetch-site") === "cross-site") throw new ForbiddenError("Requisição de outro site recusada.", "CROSS_SITE");
    } else if (token && access !== "public") {
      throw Object.assign(new UnauthorizedError("Sua sessão expirou. Entre de novo.", "SESSION_EXPIRED"), { clearCookie: true });
    }
  }

  if (access === "public") return;
  if (!meta.user) throw new UnauthorizedError();
  if (access === "admin" && meta.user.role !== "ADMIN") throw new ForbiddenError("Só administradores podem fazer isto.");
  if (meta.user.mustChangePassword && access !== "password-change") throw new ForbiddenError("Troque a senha temporária antes de continuar.", "PASSWORD_CHANGE_REQUIRED");
}

const fallbackLogger = new ConsoleLogger("http");

/** Status HTTP de cada erro de domínio. */
const DOMAIN_STATUS: Record<string, number> = {
  ValidationError: 422,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  TooManyRequestsError: 429,
  NotFoundError: 404,
  ConflictError: 409,
  DomainError: 400,
};

function errorResponse(error: unknown, meta: RequestMeta, logger: AppLogger): Response {
  const domain = domainErrorName(error);
  if (domain) {
    const e = error as DomainError & { fieldErrors?: Record<string, string>; retryAfterSeconds?: number };
    const body = (extra: object = {}) => json<ApiErrorBody>({ error: { code: e.code, message: e.message, ...extra } }, { status: DOMAIN_STATUS[domain] ?? 400 });
    if (domain === "ValidationError") return body({ fieldErrors: e.fieldErrors ?? {} });
    const response = body();
    if (domain === "TooManyRequestsError" && e.retryAfterSeconds) response.headers.set("retry-after", String(e.retryAfterSeconds));
    return response;
  }
  if (error instanceof z.ZodError || (error instanceof Error && error.name === "ZodError" && Array.isArray((error as z.ZodError).issues))) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of (error as z.ZodError).issues) fieldErrors[issue.path.join(".")] = issue.message;
    return json<ApiErrorBody>({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", fieldErrors } }, { status: 422 });
  }
  if (isIntegrationError(error)) {
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
 * Envolve um route handler: injeta o container e o contexto da requisição, exige login conforme a regra
 * de acesso (padrão: usuário logado), converte erros de domínio em respostas HTTP e devolve o cabeçalho
 * `x-request-id` (o mesmo código aparece nos logs e na auditoria).
 */
export function handler<Ctx = unknown>(fn: (request: Request, container: AppContainer, ctx: Ctx, meta: RequestMeta) => Promise<Response>, options: { access?: RouteAccess } = {}) {
  const access = options.access ?? "user";
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    const meta = requestMeta(request);
    let container: AppContainer | null = null;
    let response: Response;
    try {
      container = await getContainer();
      await authorize(request, container, meta, access);
      response = await fn(request, container, ctx, meta);
    } catch (error) {
      response = errorResponse(error, meta, container?.logger ?? fallbackLogger);
      if ((error as { clearCookie?: boolean }).clearCookie) response.headers.append("set-cookie", clearSessionCookie(cookieSecure(request)));
    }
    response.headers.set("x-request-id", meta.requestId);
    if (env().AUTH_MODE === "local" && access !== "public") response.headers.set("cache-control", "private, no-store");
    return response;
  };
}

/** Cookie Secure: AUTH_COOKIE_SECURE, ou automático pelo protocolo da requisição. */
export function cookieSecure(request: Request): boolean {
  return env().AUTH_COOKIE_SECURE ?? isHttpsRequest(request);
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
