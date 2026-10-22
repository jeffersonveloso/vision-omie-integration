import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler<Ctx>(async (_req, c, ctx, meta) => {
  const { id } = await ctx.params;
  await c.useCases.acknowledgeUpdate.execute({ orderId: id });
  const order = await c.queries.detail(id);
  await c.audit.record(meta, { action: "order.acknowledge", entityType: "ORDER", entityId: id, summary: `Ciente da alteração no Vision do pedido ${order?.visionOrderCode ?? id} após o envio.` });
  return json({ ok: true });
});
