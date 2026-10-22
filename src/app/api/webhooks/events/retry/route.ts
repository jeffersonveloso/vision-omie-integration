import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

/** Reprocessa webhooks: os escolhidos, ou todos os que falharam. */
export const POST = handler(async (request, c, _ctx, meta) => {
  const body = await readJson(request, z.object({ ids: z.array(z.string().uuid()).max(500).optional() }));
  const result = await c.useCases.retryWebhooks.execute({ ids: body.ids });
  await c.audit.record(meta, {
    action: "webhook.retry",
    entityType: "SYNC",
    summary: `${result.queued} webhook(s) do Omie ${body.ids?.length ? "escolhido(s)" : "com falha"} recolocado(s) na fila.`,
    changes: { ids: body.ids?.length ?? null, queued: result.queued },
  });
  return json(result);
});
