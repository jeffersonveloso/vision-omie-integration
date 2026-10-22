import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler<Ctx>(async (_req, c, ctx) => {
  const { id } = await ctx.params;
  await c.useCases.acknowledgeUpdate.execute({ orderId: id });
  return json({ ok: true });
});
