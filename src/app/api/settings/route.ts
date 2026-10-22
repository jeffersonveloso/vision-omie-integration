import { handler, json } from "@/server/infrastructure/http/route-handler";

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
    },
    scheduler: c.scheduler.status(),
  }),
);

export const PUT = handler(async (request, c) => {
  const body = await request.json().catch(() => null);
  const settings = await c.settings.update(body);
  return json({ settings, scheduler: c.scheduler.status() });
});
