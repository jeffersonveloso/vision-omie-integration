import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

/** Importação em massa (colar CSV: valorVision;valorOmie[;descrição]). */
export const POST = handler<Ctx>(async (request, c, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(request, z.object({ omieAccountId: z.string().uuid(), text: z.string().min(1).max(500_000) }));
  return json(await c.mappingAdmin.importEntries(id, body.omieAccountId, body.text));
});
