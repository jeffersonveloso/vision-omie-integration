import { diffValues } from "@/server/modules/audit/domain/audit-event";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { valueMapSchema } from "@/server/infrastructure/http/schemas";

type Ctx = { params: Promise<{ id: string }> };

const auditable = (m: { name: string; description: string | null; visionSourceHint?: string | null }) => ({ name: m.name, description: m.description, visionSourceHint: m.visionSourceHint ?? null });

export const PUT = handler<Ctx>(async (request, c, ctx, meta) => {
  const { id } = await ctx.params;
  const body = await readJson(request, valueMapSchema.omit({ key: true }));
  const before = await c.mappingAdmin.getMap(id);
  const map = (await c.mappingAdmin.updateMap(id, { ...body, description: body.description ?? null, visionSourceHint: body.visionSourceHint ?? null })).toSnapshot();
  await c.audit.record(meta, { action: "value-map.update", entityType: "VALUE_MAP", entityId: id, summary: `Tabela de-para "${map.name}" alterada.`, changes: diffValues(auditable(before), auditable(map)) });
  return json({ map });
});

export const DELETE = handler<Ctx>(async (_req, c, ctx, meta) => {
  const { id } = await ctx.params;
  const map = await c.mappingAdmin.deleteMap(id);
  await c.audit.record(meta, { action: "value-map.delete", entityType: "VALUE_MAP", entityId: id, summary: `Tabela de-para "${map.name}" (${map.key}) excluída com todas as linhas.` });
  return json({ ok: true });
});
