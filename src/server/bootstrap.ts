import { getContainer } from "./container";

export async function startBackgroundServices(): Promise<void> {
  try {
    const container = await getContainer();
    if (container.config.SCHEDULER_ENABLED === false) {
      container.logger.info("Agendador interno desligado (SCHEDULER_ENABLED=false). Use POST /api/sync/run com um cron externo.");
      return;
    }
    await container.scheduler.start();
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Falha ao iniciar os serviços da integração", error: String(error) }));
  }
}
