import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler<Ctx>(async (request, c, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(request, z.object({ ignored: z.boolean(), reason: z.string().max(300).nullish() }));
  await c.useCases.setIgnored.execute({ orderId: id, ignored: body.ignored, reason: body.reason });
  return json({ ok: true });
});
