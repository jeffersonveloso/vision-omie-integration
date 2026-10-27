import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { ForbiddenError } from "@/server/shared/domain/result";
import { requireLocalAuth } from "@/server/infrastructure/http/user-schemas";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual.").max(200),
  newPassword: z.string().min(1, "Informe a nova senha.").max(200),
});

/** Troca a própria senha (inclusive a temporária do primeiro acesso). Encerra as outras sessões. */
export const POST = handler(
  async (request, c, _ctx, meta) => {
    requireLocalAuth(c);
    if (meta.user?.via !== "session" || !meta.user.id || !meta.user.sessionId) throw new ForbiddenError("Só quem entrou com e-mail e senha pode trocar a senha.");
    const body = await readJson(request, passwordSchema);
    const user = await c.auth.changePassword(meta.user.id, meta.user.sessionId, body);
    await c.audit.record(meta, { action: "user.password.change", entityType: "USER", entityId: user.id, summary: `${user.name} trocou a própria senha.` });
    return json({ user });
  },
  { access: "password-change" },
);
