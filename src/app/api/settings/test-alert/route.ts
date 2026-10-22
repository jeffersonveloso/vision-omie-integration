import { handler, json } from "@/server/infrastructure/http/route-handler";

/** Envia uma mensagem de teste ao canal de alertas (Slack). */
export const POST = handler(async (_req, c, _ctx, meta) => {
  try {
    await c.alerts.sendTest(meta.actor);
    await c.audit.record(meta, { action: "alerts.test", entityType: "SETTINGS", summary: "Mensagem de teste enviada ao Slack." });
    return json({ ok: true, message: "Mensagem de teste enviada. Confira o canal no Slack." });
  } catch (error) {
    return json({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});
