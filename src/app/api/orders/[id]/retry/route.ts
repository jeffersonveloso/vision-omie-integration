import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

/** Reenvio manual do pedido (executa na hora e devolve o resultado). */
export const POST = handler<Ctx>(async (_req, c, ctx, meta) => {
  const { id } = await ctx.params;
  const result = await c.useCases.retryOrder.execute({ orderId: id, actor: meta.actor });
  const order = await c.queries.detail(id);
  await c.audit.record(meta, {
    action: "order.retry",
    entityType: "ORDER",
    entityId: id,
    summary: `Reenvio manual do pedido ${order?.visionOrderCode ?? id}: ${result.ok ? "concluído" : `falhou — ${result.message}`}.`,
  });
  return json({ ok: result.ok, message: result.message, order });
});
