import { handler, json } from "@/server/infrastructure/http/route-handler";

export const GET = handler(async (_req, c) => {
  const [stats, runs, accounts] = await Promise.all([c.queries.stats(), c.queries.runs(8), c.omieAccounts.list()]);
  return json({ stats, runs, scheduler: c.scheduler.status(), accounts: accounts.map((a) => ({ id: a.id, name: a.name, active: a.active, cnpjFormatted: a.cnpjFormatted })) });
});
