import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

/** Remove a regra: o campo volta ao padrão (regra global ou catálogo). */
export const DELETE = handler<Ctx>(async (_req, c, ctx) => {
  const { id } = await ctx.params;
  await c.mappingAdmin.deleteRule(id);
  return json({ ok: true });
});
