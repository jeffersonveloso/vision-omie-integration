import { handler, json } from "@/server/infrastructure/http/route-handler";
import { USER_ROLE_LABELS } from "@/server/modules/identity/domain/user";

/** Quem está logado (barra lateral, tela da conta). Com AUTH_MODE=proxy devolve o usuário que o proxy informou. */
export const GET = handler(
  async (_req, c, _ctx, meta) => {
    const u = meta.user;
    return json({
      mode: c.config.AUTH_MODE,
      user: u
        ? {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            roleLabel: u.role === "ADMIN" || u.role === "OPERATOR" ? USER_ROLE_LABELS[u.role] : u.role === "API" ? "Token de API" : "Proxy autenticado",
            mustChangePassword: u.mustChangePassword,
          }
        : null,
    });
  },
  { access: "password-change" },
);
