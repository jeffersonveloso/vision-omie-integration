import { z } from "zod";
import { ERROR_CATEGORIES } from "@/server/modules/integration/domain/integration-error";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

const schema = z.object({
  ids: z.array(z.string().uuid()).max(500).optional(),
  category: z.enum(ERROR_CATEGORIES).optional(),
  accountId: z.string().uuid().optional(),
});

/** Reenvio em massa: selecionados, ou todos com erro de uma categoria/conta. */
export const POST = handler(async (request, c) => {
  const body = await readJson(request, schema);
  const result = await c.useCases.retryOrders.execute({ ids: body.ids, category: body.category, omieAccountId: body.accountId });
  return json(result);
});
