import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

export const DELETE = handler<Ctx>(async (_req, c, ctx) => {
  const { entryId } = await ctx.params;
  await c.mappingAdmin.deleteEntry(entryId);
  return json({ ok: true });
});
