/**
 * Worker da fila de webhooks do Omie em processo separado (escala sem duplicar o servidor web).
 *   REDIS_URL=redis://... WEBHOOK_WORKER_ENABLED=false  → no servidor web (só recebe e enfileira)
 *   REDIS_URL=redis://... npm run worker                → aqui (processa a fila)
 */
import { utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildContainer } from "../src/server/container";

/**
 * Batimento para o healthcheck do contêiner: a cada 15 s, se o Redis responde, atualiza este arquivo.
 * O Docker considera o worker saudável enquanto o arquivo tiver menos de 60 s (docker/compose.yaml).
 */
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? path.join(tmpdir(), "vision-omie-worker.heartbeat");
const HEARTBEAT_MS = 15_000;

async function main() {
  const container = await buildContainer();
  if (container.webhookQueue.mode !== "redis") {
    container.logger.error("Defina REDIS_URL: o worker separado só faz sentido com a fila no Redis.");
    process.exit(1);
  }
  await container.startWebhookWorker();
  const beat = async () => {
    try {
      await container.webhookQueue.counts();
      const now = new Date();
      try {
        utimesSync(HEARTBEAT_FILE, now, now);
      } catch {
        writeFileSync(HEARTBEAT_FILE, now.toISOString());
      }
    } catch (error) {
      container.logger.warn("Worker sem conexão com o Redis; o healthcheck vai acusar se continuar assim", { error: String(error) });
    }
  };
  await beat();
  const heartbeat = setInterval(() => void beat(), HEARTBEAT_MS);
  const shutdown = async (signal: string) => {
    clearInterval(heartbeat);
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
