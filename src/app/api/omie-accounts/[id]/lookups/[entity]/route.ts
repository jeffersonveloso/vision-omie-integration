import type { NextRequest } from "next/server";
import { z } from "zod";
import { LOOKUP_ENTITIES } from "@/server/modules/mappings/domain/types";
import { handler, json } from "@/server/infrastructure/http/route-handler";

type Ctx = { params: Promise<{ id: string; entity: string }> };

/** Lista registros de um cadastro do Omie (categorias, departamentos, projetos, produtos...) para os combos. */
export const GET = handler<Ctx>(async (request, c, ctx) => {
  const { id, entity } = await ctx.params;
  const parsed = z.enum(LOOKUP_ENTITIES).parse(entity);
  const search = (request as NextRequest).nextUrl.searchParams;
  return json(await c.omieAccounts.lookup(id, parsed, { refresh: search.get("refresh") === "1", search: search.get("search") ?? undefined }));
});
