import { diffValues } from "@/server/modules/audit/domain/audit-event";
import { handler, json } from "@/server/infrastructure/http/route-handler";

const SECTION_LABELS: Record<string, string> = {
  sync: "coleta",
  retry: "novas tentativas",
  reconcile: "retorno",
  routing: "roteamento",
  documents: "documentos",
  paymentTerms: "condições de pagamento",
  alerts: "alertas",
  logs: "retenção de logs",
  visionReturn: "convenções do retorno",
};

export const GET = handler(async (_req, c) =>
  json({
    settings: await c.settings.get(),
    environment: {
      visionApiUrl: c.config.VISION_API_URL,
      visionUserConfigured: Boolean(c.config.VISION_USERNAME),
      omieApiUrl: c.config.OMIE_API_URL,
      timeZone: c.timeZone,
      database: c.database.driver,
      schedulerEnabled: c.config.SCHEDULER_ENABLED !== false,
      webhookEnabled: Boolean(c.config.OMIE_WEBHOOK_TOKEN),
      encryptionKeyConfigured: Boolean(c.config.APP_ENCRYPTION_KEY),
      initialLookbackDaysEnv: c.config.SYNC_INITIAL_LOOKBACK_DAYS,
      slackConfigured: c.alerts.configured,
      appBaseUrl: c.config.APP_BASE_URL ?? null,
    },
    scheduler: c.scheduler.status(),
  }),
);

export const PUT = handler(async (request, c, _ctx, meta) => {
  const body = await request.json().catch(() => null);
  const before = await c.settings.get();
  const settings = await c.settings.update(body);
  const changes = diffValues(before, settings);
  if (changes.length) {
    const sections = [...new Set(changes.map((ch) => ch.path.split(".")[0]))].map((k) => SECTION_LABELS[k] ?? k).join(", ");
    await c.audit.record(meta, { action: "settings.update", entityType: "SETTINGS", summary: `Configurações alteradas (${changes.length} campo(s): ${sections}).`, changes });
  }
  return json({ settings, scheduler: c.scheduler.status() });
});
