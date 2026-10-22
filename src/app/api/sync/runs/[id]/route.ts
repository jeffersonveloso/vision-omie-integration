import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

/** Linha do tempo de uma execução (inclui as chamadas de coleta no Vision e todos os pedidos tocados). */
export const GET = handler<Ctx>(async (_req, c, ctx) => {
  const { id } = await ctx.params;
  return json({ logs: await c.queries.logs({ runId: id, limit: 1000 }) });
});
