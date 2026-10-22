import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

/** Importação em massa (colar CSV: valorVision;valorOmie[;descrição]). */
export const POST = handler<Ctx>(async (request, c, ctx, meta) => {
  const { id } = await ctx.params;
  const body = await readJson(request, z.object({ omieAccountId: z.string().uuid(), text: z.string().min(1).max(500_000) }));
  const result = await c.mappingAdmin.importEntries(id, body.omieAccountId, body.text);
  const [map, account] = await Promise.all([c.mappingAdmin.getMap(id), c.omieAccounts.get(body.omieAccountId)]);
  await c.audit.record(meta, {
    action: "value-map.import",
    entityType: "VALUE_MAP",
    entityId: id,
    summary: `Importação no de-para "${map.name}" (conta ${account.toPublic().name}): ${result.imported} linha(s) gravada(s), ${result.skipped.length} ignorada(s).`,
    changes: { omieAccountId: body.omieAccountId, imported: result.imported, skipped: result.skipped.slice(0, 20) },
  });
  return json(result);
});
