/**
 * Executado uma vez quando o servidor Next.js inicia: prepara o banco (migrações)
 * e liga o agendador da integração (coleta Vision → Omie e retorno Omie → Vision).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startBackgroundServices } = await import("./server/bootstrap");
  await startBackgroundServices();
}
