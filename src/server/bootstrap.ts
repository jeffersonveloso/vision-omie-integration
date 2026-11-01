import { getContainer } from "./container";
import { installGracefulShutdown } from "./shutdown";

export async function startBackgroundServices(): Promise<void> {
  try {
    const container = await getContainer();
    // Com NEXT_MANUAL_SIG_HANDLE o Next deixa o SIGTERM com a aplicação; sem ele, o Next encerra sozinho.
    if (process.env.NEXT_MANUAL_SIG_HANDLE) installGracefulShutdown(container, container.config.SHUTDOWN_TIMEOUT_MS);
    // Worker da fila de webhooks (Redis). Com WEBHOOK_WORKER_ENABLED=false ele roda à parte: npm run worker.
    if (container.webhookQueue.mode === "redis" && container.config.WEBHOOK_WORKER_ENABLED !== false) await container.startWebhookWorker();
    if (container.config.SCHEDULER_ENABLED === false) {
      container.logger.info("Agendador interno desligado (SCHEDULER_ENABLED=false). Use POST /api/sync/run com um cron externo.");
      return;
    }
    await container.scheduler.start();
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Falha ao iniciar os serviços da integração", error: String(error) }));
  }
}
