import { clearSessionCookie, readCookie, SESSION_COOKIE } from "@/server/infrastructure/http/auth-cookie";
import { cookieSecure, handler, json } from "@/server/infrastructure/http/route-handler";

/** Sair: apaga a sessão no banco e o cookie no navegador (funciona mesmo com a sessão já expirada). */
export const POST = handler(
  async (request, c, _ctx, meta) => {
    const session = await c.auth.logout(readCookie(request.headers.get("cookie"), SESSION_COOKIE));
    if (session && meta.user) await c.audit.record(meta, { action: "auth.logout", entityType: "USER", entityId: session.userId, summary: `${meta.user.name} saiu da aplicação.` });
    const response = json({ ok: true });
    response.headers.append("set-cookie", clearSessionCookie(cookieSecure(request)));
    return response;
  },
  { access: "public" },
);
