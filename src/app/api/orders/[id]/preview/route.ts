import type { NextRequest } from "next/server";
import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string }> };

/** Simulação do mapeamento (payloads que seriam enviados ao Omie), sem chamar o Omie. */
export const GET = handler<Ctx>(async (request, c, ctx) => {
  const { id } = await ctx.params;
  const search = (request as NextRequest).nextUrl.searchParams;
  const preview = await c.useCases.preview.execute({ orderId: id, omieAccountId: search.get("account"), refresh: search.get("refresh") === "1" });
  return json(preview);
});
