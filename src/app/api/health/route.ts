import { handler, json } from "@/server/infrastructure/http/route-handler";

/**
 * Saúde da aplicação. Sem login responde só se está no ar (healthcheck do Docker, balanceador);
 * logado, traz também o estado do agendador (barra lateral).
 */
export const GET = handler(
  async (_req, c, _ctx, meta) => {
    const base = { ok: true, database: c.database.driver, time: new Date().toISOString() };
    const identified = c.config.AUTH_MODE === "proxy" || !!meta.user;
    return json(identified ? { ...base, scheduler: c.scheduler.status() } : base);
  },
  { access: "public" },
);
