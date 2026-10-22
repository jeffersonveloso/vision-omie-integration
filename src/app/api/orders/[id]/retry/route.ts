import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

/** Reenvio manual do pedido (executa na hora e devolve o resultado). */
export const POST = handler<Ctx>(async (_req, c, ctx) => {
  const { id } = await ctx.params;
  const result = await c.useCases.retryOrder.execute({ orderId: id });
  const order = await c.queries.detail(id);
  return json({ ok: result.ok, message: result.message, order });
});
