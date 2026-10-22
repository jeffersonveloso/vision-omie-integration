import { handler, json } from "@/server/infrastructure/http/route-handler";

/** Até onde a coleta incremental chegou e de onde a próxima começa. */
export const GET = handler(async (_req, c) => json({ collection: await c.collectionWindow.status() }));

/** Recomeça a coleta: a próxima execução volta a buscar os últimos N dias (sem duplicar pedidos). */
export const DELETE = handler(async (_req, c, _ctx, meta) => {
  const before = await c.collectionWindow.status();
  const collection = await c.collectionWindow.restart();
  await c.audit.record(meta, {
    action: "sync.collection.restart",
    entityType: "SYNC",
    summary: `Coleta recomeçada: a próxima busca pedidos desde ${collection.nextFrom} (últimos ${collection.initialLookbackDays} dias).`,
    changes: { lastUpdatedAt: before.lastUpdatedAt, nextFrom: collection.nextFrom },
  });
  return json({ collection });
});
