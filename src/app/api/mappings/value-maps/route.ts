import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { valueMapSchema } from "@/server/infrastructure/http/schemas";

export const GET = handler(async (_req, c) => json({ maps: await c.mappingAdmin.listMaps() }));

export const POST = handler(async (request, c) => {
  const body = await readJson(request, valueMapSchema);
  const map = await c.mappingAdmin.createMap({ ...body, description: body.description ?? null, visionSourceHint: body.visionSourceHint ?? null });
  return json({ map: map.toSnapshot() }, { status: 201 });
});
