import { handler, json } from "@/server/infrastructure/http/route-handler";

/**
 * Saúde da aplicação (healthcheck do Docker, balanceador, monitor externo). Confere se o banco responde:
 * fora do ar → 503. Sem login diz só isso; logado, traz também o estado do agendador (barra lateral).
 */
export const GET = handler(
  async (_req, c, _ctx, meta) => {
    const time = new Date().toISOString();
    try {
      await c.database.ping(3_000);
    } catch (error) {
      c.logger.warn("Health: banco sem resposta", { error: error instanceof Error ? error.message : String(error) });
      return json({ ok: false, database: c.database.driver, databaseOk: false, time }, { status: 503 });
    }
    const base = { ok: true, database: c.database.driver, databaseOk: true, time };
    const identified = c.config.AUTH_MODE === "proxy" || !!meta.user;
    return json(identified ? { ...base, scheduler: c.scheduler.status() } : base);
  },
  { access: "public" },
);
