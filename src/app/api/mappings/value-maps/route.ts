import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { valueMapSchema } from "@/server/infrastructure/http/schemas";

export const GET = handler(async (_req, c) => json({ maps: await c.mappingAdmin.listMaps() }));

export const POST = handler(async (request, c, _ctx, meta) => {
  const body = await readJson(request, valueMapSchema);
  const map = (await c.mappingAdmin.createMap({ ...body, description: body.description ?? null, visionSourceHint: body.visionSourceHint ?? null })).toSnapshot();
  await c.audit.record(meta, { action: "value-map.create", entityType: "VALUE_MAP", entityId: map.id, summary: `Tabela de-para "${map.name}" (${map.key}) criada.`, changes: { name: map.name, key: map.key, description: map.description } });
  return json({ map }, { status: 201 });
});
