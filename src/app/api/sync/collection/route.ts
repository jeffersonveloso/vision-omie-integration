import { handler, json } from "@/server/infrastructure/http/route-handler";

/** Até onde a coleta incremental chegou e de onde a próxima começa. */
export const GET = handler(async (_req, c) => json({ collection: await c.collectionWindow.status() }));

/** Recomeça a coleta: a próxima execução volta a buscar os últimos N dias (sem duplicar pedidos). */
export const DELETE = handler(async (_req, c) => json({ collection: await c.collectionWindow.restart() }));
