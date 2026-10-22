import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";
import { accountSchema } from "@/server/infrastructure/http/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler<Ctx>(async (_req, c, ctx) => {
  const { id } = await ctx.params;
  return json({ account: (await c.omieAccounts.get(id)).toPublic() });
});

/** Edição completa. App Secret vazio mantém o segredo atual. */
export const PUT = handler<Ctx>(async (request, c, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(request, accountSchema);
  return json({ account: await c.omieAccounts.update(id, body) });
});

/** Liga/desliga a integração da conta. */
export const PATCH = handler<Ctx>(async (request, c, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(request, z.object({ active: z.boolean() }));
  return json({ account: await c.omieAccounts.setActive(id, body.active) });
});

export const DELETE = handler<Ctx>(async (_req, c, ctx) => {
  const { id } = await ctx.params;
  await c.omieAccounts.delete(id);
  return json({ ok: true });
});
