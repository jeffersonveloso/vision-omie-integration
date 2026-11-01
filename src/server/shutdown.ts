import type { AppContainer } from "./container";
import { lifecycle } from "./infrastructure/http/lifecycle";

type ShutdownTarget = Pick<AppContainer, "logger" | "scheduler" | "webhookQueue" | "database">;

/**
 * Desligamento ordenado (docker stop, nova versão, reinício):
 * 1. para de aceitar requisições novas na API (503) e de iniciar rotinas;
 * 2. espera as rotinas e as requisições em andamento (um envio ao Omie não fica pela metade);
 * 3. fecha a fila (o worker termina o job atual) e o banco.
 */
export async function gracefulShutdown(container: ShutdownTarget, timeoutMs: number, signal: string): Promise<{ jobsDone: boolean; requestsDone: boolean }> {
  const { logger } = container;
  const begin = Date.now();
  logger.info("Desligando: esperando rotinas e requisições em andamento", { signal, prazoSegundos: Math.round(timeoutMs / 1000) });
  lifecycle.markShuttingDown();
  const jobsDone = await container.scheduler.drain(timeoutMs);
  const requestsDone = await lifecycle.waitIdle(Math.max(1_000, timeoutMs - (Date.now() - begin)));
  if (!jobsDone || !requestsDone) {
    logger.warn("Prazo do desligamento esgotado com trabalho em andamento; o pedido interrompido é retomado na próxima execução sem duplicar no Omie", { rotinasTerminaram: jobsDone, requisicoesAbertas: lifecycle.activeRequests() });
  }
  await container.webhookQueue.close().catch((error) => logger.warn("Falha ao fechar a fila", { error: String(error) }));
  await container.database.close().catch((error) => logger.warn("Falha ao fechar o banco", { error: String(error) }));
  logger.info("Aplicação encerrada", { segundos: Math.round((Date.now() - begin) / 100) / 10 });
  return { jobsDone, requestsDone };
}

/** O Next só deixa a aplicação cuidar do sinal com NEXT_MANUAL_SIG_HANDLE=true (a imagem Docker já define). */
export function installGracefulShutdown(container: ShutdownTarget, timeoutMs: number): void {
  let started = false;
  const onSignal = (signal: string) => {
    if (started) return;
    started = true;
    void gracefulShutdown(container, timeoutMs, signal).finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));
}
