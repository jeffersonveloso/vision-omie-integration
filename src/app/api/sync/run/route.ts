import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

const RESULT = { RUNNING: "em andamento", SUCCESS: "sem erros", PARTIAL: "com pendências", FAILED: "falhou", SKIPPED: "não executada: outra já estava em andamento" } as const;

const schema = z.object({ job: z.enum(["SYNC", "RECONCILE"]).default("SYNC") });

/**
 * Dispara uma rotina na hora (botão "Sincronizar agora" ou cron externo).
 * A trava no banco impede duas execuções simultâneas da mesma rotina.
 */
export const POST = handler(async (request, c, _ctx, meta) => {
  const body = await readJson(request, schema).catch(() => ({ job: "SYNC" as const }));
  const run = body.job === "RECONCILE" ? await c.useCases.reconcileJob.execute({ trigger: "MANUAL" }) : await c.useCases.syncJob.execute({ trigger: "MANUAL" });
  await c.audit.record(meta, {
    action: body.job === "RECONCILE" ? "sync.reconcile" : "sync.run",
    entityType: "SYNC",
    entityId: run.id,
    summary: `${body.job === "RECONCILE" ? "Retorno ao Vision" : "Coleta e envio"} executado manualmente: ${RESULT[run.status]}.`,
    changes: { status: run.status, stats: run.stats },
  });
  return json({ run });
});
