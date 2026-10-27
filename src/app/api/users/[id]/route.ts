import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { requireLocalAuth, updateUserSchema } from "@/server/infrastructure/http/user-schemas";
import { diffValues } from "@/server/modules/audit/domain/audit-event";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler<Ctx>(
  async (_req, c, ctx) => {
    requireLocalAuth(c);
    return json({ user: await c.userAdmin.get((await ctx.params).id) });
  },
  { access: "admin" },
);

/** Altera nome, perfil ou situação (desativar encerra as sessões do usuário). */
export const PATCH = handler<Ctx>(
  async (request, c, ctx, meta) => {
    requireLocalAuth(c);
    const { id } = await ctx.params;
    const body = await readJson(request, updateUserSchema);
    const { before, after } = await c.userAdmin.update(id, body, meta.user?.id ?? null);
    const pick = (u: typeof before) => ({ nome: u.name, perfil: u.roleLabel, ativo: u.active });
    const what = before.active !== after.active ? (after.active ? "reativado" : "desativado") : "alterado";
    await c.audit.record(meta, { action: "user.update", entityType: "USER", entityId: id, summary: `Usuário ${after.name} (${after.email}) ${what}.`, changes: diffValues(pick(before), pick(after)) });
    return json({ user: after });
  },
  { access: "admin" },
);
