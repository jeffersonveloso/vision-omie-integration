import { z } from "zod";
import { cookieSecure, handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { sessionCookie } from "@/server/infrastructure/http/auth-cookie";
import { isDomainError } from "@/server/shared/domain/result";
import { requireLocalAuth } from "@/server/infrastructure/http/user-schemas";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Informe o e-mail.").max(200),
  password: z.string().min(1, "Informe a senha.").max(200),
});

/** Entrar: confere e-mail e senha, cria a sessão e devolve o cookie. Tentativas erradas vão para a auditoria. */
export const POST = handler(
  async (request, c, _ctx, meta) => {
    requireLocalAuth(c);
    const body = await readJson(request, loginSchema);
    try {
      const result = await c.auth.login(body, { ip: meta.ip, userAgent: meta.userAgent });
      await c.audit.record({ ...meta, actor: result.user.email }, { action: "auth.login", entityType: "USER", entityId: result.user.id, summary: `${result.user.name} entrou na aplicação.` });
      const response = json({ user: result.view });
      response.headers.append("set-cookie", sessionCookie(result.token, result.session.expiresAt, cookieSecure(request)));
      return response;
    } catch (error) {
      if (isDomainError(error) && (error.code === "INVALID_CREDENTIALS" || error.code === "TOO_MANY_ATTEMPTS")) {
        const email = body.email.trim().toLowerCase().slice(0, 200);
        await c.audit.record(meta, {
          action: error.code === "INVALID_CREDENTIALS" ? "auth.login.failed" : "auth.login.blocked",
          entityType: "USER",
          summary: error.code === "INVALID_CREDENTIALS" ? `Tentativa de entrar com e-mail ou senha incorretos (${email}).` : `Tentativa de entrar com o acesso bloqueado por excesso de tentativas (${email}).`,
        });
      }
      throw error;
    }
  },
  { access: "public" },
);
