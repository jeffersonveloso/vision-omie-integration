import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler<Ctx>(async (request, c, ctx, meta) => {
  const { id } = await ctx.params;
  const body = await readJson(request, z.object({ ignored: z.boolean(), reason: z.string().max(300).nullish() }));
  await c.useCases.setIgnored.execute({ orderId: id, ignored: body.ignored, reason: body.reason, actor: meta.actor });
  const order = await c.queries.detail(id);
  await c.audit.record(meta, {
    action: body.ignored ? "order.ignore" : "order.unignore",
    entityType: "ORDER",
    entityId: id,
    summary: `Pedido ${order?.visionOrderCode ?? id} ${body.ignored ? `ignorado${body.reason ? `: ${body.reason}` : ""}` : "voltou para a integração"}.`,
  });
  return json({ ok: true });
});
