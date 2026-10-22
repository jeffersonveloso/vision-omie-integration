import { handler, json } from "@/server/infrastructure/http/route-handler";

export const GET = handler(async (_req, c) => json({ ok: true, database: c.database.driver, scheduler: c.scheduler.status(), time: new Date().toISOString() }));
