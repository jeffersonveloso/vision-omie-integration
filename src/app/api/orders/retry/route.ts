import { z } from "zod";
import { ERROR_CATEGORIES, ERROR_CATEGORY_LABELS } from "@/server/modules/integration/domain/integration-error";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

const schema = z.object({
  ids: z.array(z.string().uuid()).max(500).optional(),
  category: z.enum(ERROR_CATEGORIES).optional(),
  accountId: z.string().uuid().optional(),
});

/** Reenvio em massa: selecionados, ou todos com erro de uma categoria/conta. */
export const POST = handler(async (request, c, _ctx, meta) => {
  const body = await readJson(request, schema);
  const result = await c.useCases.retryOrders.execute({ ids: body.ids, category: body.category, omieAccountId: body.accountId, actor: meta.actor });
  await c.audit.record(meta, {
    action: "order.retry-bulk",
    entityType: "ORDER",
    summary: `Reenvio em lote${body.category ? ` (${ERROR_CATEGORY_LABELS[body.category]})` : body.ids ? " dos selecionados" : ""}: ${result.succeeded} de ${result.total} concluído(s).`,
    changes: { filtro: { ids: body.ids?.length ?? null, category: body.category ?? null, accountId: body.accountId ?? null }, total: result.total, succeeded: result.succeeded, failed: result.failed },
  });
  return json(result);
});
