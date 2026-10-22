import { NotFoundError } from "@/server/shared/domain/result";
import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler<Ctx>(async (_req, c, ctx) => {
  const { id } = await ctx.params;
  const detail = await c.queries.detail(id);
  if (!detail) throw new NotFoundError("Pedido", id);
  const logs = await c.queries.logs({ orderId: id, limit: 500 });
  return json({ order: detail, logs });
});
