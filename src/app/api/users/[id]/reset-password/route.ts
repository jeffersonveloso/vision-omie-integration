import { handler, json } from "@/server/infrastructure/http/route-handler";
import { requireLocalAuth } from "@/server/infrastructure/http/user-schemas";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Gera uma senha temporária (devolvida só nesta resposta), desbloqueia a conta e encerra as sessões.
 * O usuário troca a senha no próximo acesso.
 */
export const POST = handler<Ctx>(
  async (_req, c, ctx, meta) => {
    requireLocalAuth(c);
    const { id } = await ctx.params;
    const result = await c.userAdmin.resetPassword(id);
    await c.audit.record(meta, { action: "user.password.reset", entityType: "USER", entityId: id, summary: `Senha temporária gerada para ${result.user.name} (${result.user.email}).` });
    return json(result);
  },
  { access: "admin" },
);
