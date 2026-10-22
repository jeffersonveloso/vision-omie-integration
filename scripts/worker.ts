/**
 * Worker da fila de webhooks do Omie em processo separado (escala sem duplicar o servidor web).
 *   REDIS_URL=redis://... WEBHOOK_WORKER_ENABLED=false  → no servidor web (só recebe e enfileira)
 *   REDIS_URL=redis://... npm run worker                → aqui (processa a fila)
 */
import { buildContainer } from "../src/server/container";

async function main() {
  const container = await buildContainer();
  if (container.webhookQueue.mode !== "redis") {
    container.logger.error("Defina REDIS_URL: o worker separado só faz sentido com a fila no Redis.");
    process.exit(1);
  }
  await container.startWebhookWorker();
  const shutdown = async (signal: string) => {
    container.logger.info("Encerrando o worker da fila de webhooks", { signal });
    await container.webhookQueue.close();
    await container.database.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
