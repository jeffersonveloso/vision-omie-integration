import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler<Ctx>(async (request, c, ctx) => {
  const { id } = await ctx.params;
  const accountId = z.string().uuid().parse((request as NextRequest).nextUrl.searchParams.get("accountId"));
  return json({ entries: await c.mappingAdmin.listEntries(id, accountId) });
});

const entrySchema = z.object({
  id: z.string().uuid().nullish(),
  omieAccountId: z.string().uuid(),
  visionValue: z.union([z.string(), z.number()]).transform(String),
  visionLabel: z.string().max(200).nullish(),
  omieValue: z.union([z.string(), z.number()]).transform(String),
  omieLabel: z.string().max(300).nullish(),
});

/** Cria/atualiza uma linha do de-para (ex.: produto Vision 123 → produto Omie 4422421). */
export const POST = handler<Ctx>(async (request, c, ctx, meta) => {
  const { id } = await ctx.params;
  const body = await readJson(request, entrySchema);
  const entry = await c.mappingAdmin.upsertEntry({ ...body, valueMapId: id });
  const [map, account] = await Promise.all([c.mappingAdmin.getMap(id), c.omieAccounts.get(body.omieAccountId)]);
  await c.audit.record(meta, {
    action: body.id ? "value-map.entry.update" : "value-map.entry.save",
    entityType: "VALUE_MAP",
    entityId: id,
    summary: `De-para "${map.name}" na conta ${account.toPublic().name}: ${entry.visionValue} → ${entry.omieValue}${entry.omieLabel ? ` (${entry.omieLabel})` : ""}.`,
    changes: { visionValue: entry.visionValue, omieValue: entry.omieValue, omieLabel: entry.omieLabel, omieAccountId: body.omieAccountId },
  });
  return json({ entry });
});
