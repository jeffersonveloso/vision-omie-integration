/**
 * Login próprio (AUTH_MODE=local) pelas rotas HTTP: primeiro administrador, cookie de sessão, 401/403/429,
 * token de API, cabeçalho de proxy ignorado, troca de senha obrigatória, cadastro de usuários e auditoria.
 */
process.env.AUTH_MODE = "local";
process.env.AUTH_ADMIN_EMAIL = "admin@ecolife.test";
process.env.AUTH_ADMIN_PASSWORD = "girassol-azul-2026";
process.env.AUTH_ADMIN_NAME = "Administração";
process.env.AUTH_API_TOKEN = "token-de-api-com-mais-de-32-caracteres";
process.env.OMIE_WEBHOOK_TOKEN = "token-webhook-teste";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as auditRoute from "@/app/api/audit/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as passwordRoute from "@/app/api/auth/password/route";
import * as healthRoute from "@/app/api/health/route";
import * as ordersRoute from "@/app/api/orders/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as resetRoute from "@/app/api/users/[id]/reset-password/route";
import * as userRoute from "@/app/api/users/[id]/route";
import * as usersRoute from "@/app/api/users/route";
import * as webhookRoute from "@/app/api/webhooks/omie/route";
import { type AppContainer, buildContainer } from "@/server/container";
import { ScryptPasswordHasher } from "@/server/modules/identity/infrastructure/scrypt-password-hasher";
import { createTestDatabase } from "./support/test-database";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RouteFn = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ADMIN = { email: "admin@ecolife.test", password: "girassol-azul-2026" };

describe("login próprio", () => {
  let app: AppContainer;
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let adminCookie = "";

  async function call(mod: object, method: Method, path: string, opts: { body?: unknown; headers?: Record<string, string>; params?: Record<string, string>; cookie?: string } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
    if (opts.cookie) headers.cookie = opts.cookie;
    const request = new NextRequest(`http://localhost${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const response = await (mod as Record<string, RouteFn>)[method](request, { params: Promise.resolve(opts.params ?? {}) });
    return { status: response.status, headers: response.headers, body: (await response.json()) as Json };
  }

  /** Entra e devolve o cookie no formato do cabeçalho Cookie. */
  async function login(email: string, password: string, headers: Record<string, string> = {}) {
    const response = await call(loginRoute, "POST", "/api/auth/login", { body: { email, password }, headers });
    const setCookie = response.headers.get("set-cookie") ?? "";
    return { ...response, setCookie, cookie: setCookie.split(";")[0] };
  }

  const audit = async (query: string) => (await call(auditRoute, "GET", `/api/audit${query}`, { cookie: adminCookie })).body.items as Json[];

  beforeAll(async () => {
    app = await buildContainer({ databaseUrl: (database = await createTestDatabase()).url, passwordHasher: new ScryptPasswordHasher({ N: 2 ** 10, r: 8, p: 1 }) });
    (globalThis as unknown as { __visionOmieContainer?: Promise<AppContainer> }).__visionOmieContainer = Promise.resolve(app);
  });

  afterAll(async () => {
    await app?.database.close();
    await database?.drop();
  });

  it("sem login: 401 nas rotas, health só diz se está no ar, webhook segue com o token próprio", async () => {
    const orders = await call(ordersRoute, "GET", "/api/orders");
    expect(orders.status).toBe(401);
    expect(orders.body.error.code).toBe("UNAUTHENTICATED");
    expect(orders.headers.get("x-request-id")).toBeTruthy();

    // O cabeçalho de proxy não vale no login próprio: qualquer um poderia forjá-lo.
    expect((await call(ordersRoute, "GET", "/api/orders", { headers: { "x-forwarded-email": "intruso@x.com" } })).status).toBe(401);

    const health = await call(healthRoute, "GET", "/api/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.scheduler).toBeUndefined();

    expect((await call(webhookRoute, "POST", "/api/webhooks/omie?token=errado", { body: {} })).status).toBe(401);
    expect((await call(webhookRoute, "POST", "/api/webhooks/omie?token=token-webhook-teste", { body: { messageId: "m-1", topic: "Teste" } })).status).toBe(200);
  });

  it("primeiro administrador vem das variáveis; login devolve cookie httpOnly e Secure só em HTTPS", async () => {
    const wrong = await login(ADMIN.email, "senha-errada-123");
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: "INVALID_CREDENTIALS", message: "E-mail ou senha incorretos." });
    expect(wrong.setCookie).toBe("");

    const ok = await login("ADMIN@ecolife.test", ADMIN.password);
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email: ADMIN.email, name: "Administração", role: "ADMIN", mustChangePassword: false });
    expect(ok.body.user.passwordHash).toBeUndefined();
    expect(ok.setCookie).toMatch(/^vo_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Expires=/);
    expect(ok.setCookie).not.toContain("Secure");
    adminCookie = ok.cookie;

    expect((await login(ADMIN.email, ADMIN.password, { "x-forwarded-proto": "https" })).setCookie).toContain("; Secure");

    const me = await call(meRoute, "GET", "/api/auth/me", { cookie: adminCookie });
    expect(me.body).toMatchObject({ mode: "local", user: { email: ADMIN.email, roleLabel: "Administrador" } });
    const orders = await call(ordersRoute, "GET", "/api/orders", { cookie: adminCookie, headers: { "x-forwarded-email": "intruso@x.com" } });
    expect(orders.status).toBe(200);
    expect(orders.headers.get("cache-control")).toBe("private, no-store");
    expect((await call(healthRoute, "GET", "/api/health", { cookie: adminCookie })).body.scheduler).toBeDefined();

    const events = await audit("?entityType=USER");
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["user.bootstrap", "auth.login", "auth.login.failed"]));
    expect(events.find((e) => e.action === "auth.login")).toMatchObject({ actor: ADMIN.email });
    expect(events.find((e) => e.action === "auth.login.failed").summary).toContain(ADMIN.email);
  });

  it("alteração com sessão recusa requisição de outro site e grava o autor logado", async () => {
    const settings = (await call(settingsRoute, "GET", "/api/settings", { cookie: adminCookie })).body.settings;
    const cross = await call(settingsRoute, "PUT", "/api/settings", { cookie: adminCookie, body: settings, headers: { "sec-fetch-site": "cross-site" } });
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe("CROSS_SITE");
    const same = await call(settingsRoute, "PUT", "/api/settings", { cookie: adminCookie, body: { ...settings, sync: { ...settings.sync, pageSize: 70 } }, headers: { "sec-fetch-site": "same-origin" } });
    expect(same.status).toBe(200);
    expect((await audit("?entityType=SETTINGS"))[0]).toMatchObject({ actor: ADMIN.email });
  });

  it("token de API: entra nas rotas da integração, não no cadastro de usuários; token errado é 401", async () => {
    const bearer = { authorization: "Bearer token-de-api-com-mais-de-32-caracteres" };
    expect((await call(ordersRoute, "GET", "/api/orders", { headers: bearer })).status).toBe(200);
    expect((await call(usersRoute, "GET", "/api/users", { headers: bearer })).status).toBe(403);
    const wrong = await call(ordersRoute, "GET", "/api/orders", { headers: { authorization: "Bearer outro" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_TOKEN");
    const me = await call(meRoute, "GET", "/api/auth/me", { headers: bearer });
    expect(me.body.user).toMatchObject({ role: "API", roleLabel: "Token de API" });
    expect((await call(passwordRoute, "POST", "/api/auth/password", { headers: bearer, body: { currentPassword: "x", newPassword: "y" } })).status).toBe(403);
  });

  it("operador: senha temporária obriga a troca antes de usar; não cadastra usuários", async () => {
    const created = await call(usersRoute, "POST", "/api/users", { cookie: adminCookie, body: { name: "Bia Lima", email: "Bia@Ecolife.test", role: "OPERATOR" } });
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ email: "bia@ecolife.test", roleLabel: "Operador", mustChangePassword: true });
    const temporary = created.body.temporaryPassword as string;
    expect(temporary).toHaveLength(14);
    expect((await call(usersRoute, "POST", "/api/users", { cookie: adminCookie, body: { name: "Bia de novo", email: "bia@ecolife.test", role: "OPERATOR" } })).status).toBe(409);
    expect((await call(usersRoute, "POST", "/api/users", { cookie: adminCookie, body: { name: "X", email: "não é e-mail", role: "CHEFE" } })).body.error.fieldErrors).toMatchObject({ email: "E-mail inválido.", role: "Escolha o perfil." });

    const bia = await login("bia@ecolife.test", temporary);
    expect(bia.body.user.mustChangePassword).toBe(true);
    const blocked = await call(ordersRoute, "GET", "/api/orders", { cookie: bia.cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await call(meRoute, "GET", "/api/auth/me", { cookie: bia.cookie })).status).toBe(200);

    const short = await call(passwordRoute, "POST", "/api/auth/password", { cookie: bia.cookie, body: { currentPassword: temporary, newPassword: "curta" } });
    expect(short.status).toBe(422);
    expect(short.body.error.fieldErrors.newPassword).toMatch(/10 caracteres/);
    expect((await call(passwordRoute, "POST", "/api/auth/password", { cookie: bia.cookie, body: { currentPassword: temporary, newPassword: "jabuticaba-madura-9" } })).status).toBe(200);

    expect((await call(ordersRoute, "GET", "/api/orders", { cookie: bia.cookie })).status).toBe(200);
    const forbidden = await call(usersRoute, "GET", "/api/users", { cookie: bia.cookie });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.message).toBe("Só administradores podem fazer isto.");
    expect((await audit("?search=user.password.change"))[0]).toMatchObject({ actor: "bia@ecolife.test" });
  });

  it("senha errada repetida bloqueia (429); senha temporária desbloqueia e derruba as sessões", async () => {
    const { body } = await call(usersRoute, "GET", "/api/users", { cookie: adminCookie });
    const bia = body.users.find((u: Json) => u.email === "bia@ecolife.test");
    const session = await login("bia@ecolife.test", "jabuticaba-madura-9");
    for (let i = 0; i < 5; i++) expect((await login("bia@ecolife.test", "errada-errada-errada")).status).toBe(401);
    const locked = await login("bia@ecolife.test", "jabuticaba-madura-9");
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBe("900");
    expect(locked.body.error.message).toMatch(/15 minutos/);
    expect((await call(userRoute, "GET", `/api/users/${bia.id}`, { cookie: adminCookie, params: { id: bia.id } })).body.user.locked).toBe(true);
    expect((await audit("?search=auth.login.blocked")).length).toBe(1);

    const reset = await call(resetRoute, "POST", `/api/users/${bia.id}/reset-password`, { cookie: adminCookie, params: { id: bia.id } });
    expect(reset.status).toBe(200);
    expect(reset.body.user).toMatchObject({ locked: false, mustChangePassword: true });
    const expired = await call(ordersRoute, "GET", "/api/orders", { cookie: session.cookie });
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe("SESSION_EXPIRED");
    expect(expired.headers.get("set-cookie")).toMatch(/^vo_session=; .*Max-Age=0/);
    expect((await login("bia@ecolife.test", reset.body.temporaryPassword)).status).toBe(200);
  });

  it("desativar encerra o acesso; ninguém tira o próprio acesso de administrador; sair apaga a sessão", async () => {
    const { body } = await call(usersRoute, "GET", "/api/users", { cookie: adminCookie });
    const admin = body.users.find((u: Json) => u.email === ADMIN.email);
    const bia = body.users.find((u: Json) => u.email === "bia@ecolife.test");
    const biaSession = await login("bia@ecolife.test", (await call(resetRoute, "POST", "/", { cookie: adminCookie, params: { id: bia.id } })).body.temporaryPassword);

    const self = await call(userRoute, "PATCH", "/", { cookie: adminCookie, params: { id: admin.id }, body: { role: "OPERATOR" } });
    expect(self.status).toBe(403);
    expect((await call(userRoute, "PATCH", "/", { cookie: adminCookie, params: { id: admin.id }, body: {} })).status).toBe(422);
    expect((await call(userRoute, "PATCH", "/", { cookie: adminCookie, params: { id: "00000000-0000-4000-8000-000000000000" }, body: { name: "Ninguém" } })).status).toBe(404);

    const off = await call(userRoute, "PATCH", "/", { cookie: adminCookie, params: { id: bia.id }, body: { active: false } });
    expect(off.body.user.active).toBe(false);
    expect((await call(meRoute, "GET", "/api/auth/me", { cookie: biaSession.cookie })).status).toBe(401);
    expect((await audit("?search=desativado"))[0]).toMatchObject({ action: "user.update", changes: [{ path: "ativo", before: true, after: false }] });

    const out = await call(logoutRoute, "POST", "/api/auth/logout", { cookie: adminCookie });
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await call(ordersRoute, "GET", "/api/orders", { cookie: adminCookie })).status).toBe(401);
    expect((await call(logoutRoute, "POST", "/api/auth/logout")).status).toBe(200);
  });
});
