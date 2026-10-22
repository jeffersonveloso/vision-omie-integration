import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { valueMapSchema } from "@/server/infrastructure/http/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handler<Ctx>(async (request, c, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(request, valueMapSchema.omit({ key: true }));
  const map = await c.mappingAdmin.updateMap(id, { ...body, description: body.description ?? null, visionSourceHint: body.visionSourceHint ?? null });
  return json({ map: map.toSnapshot() });
});

export const DELETE = handler<Ctx>(async (_req, c, ctx) => {
  const { id } = await ctx.params;
  await c.mappingAdmin.deleteMap(id);
  return json({ ok: true });
});
