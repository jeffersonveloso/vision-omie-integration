import { z } from "zod";
import { handler, json, readJson } from "@/server/infrastructure/http/route-handler";

const schema = z.object({ job: z.enum(["SYNC", "RECONCILE"]).default("SYNC") });

/**
 * Dispara uma rotina na hora (botão "Sincronizar agora" ou cron externo).
 * A trava no banco impede duas execuções simultâneas da mesma rotina.
 */
export const POST = handler(async (request, c) => {
  const body = await readJson(request, schema).catch(() => ({ job: "SYNC" as const }));
  const run = body.job === "RECONCILE" ? await c.useCases.reconcileJob.execute({ trigger: "MANUAL" }) : await c.useCases.syncJob.execute({ trigger: "MANUAL" });
  return json({ run });
});
