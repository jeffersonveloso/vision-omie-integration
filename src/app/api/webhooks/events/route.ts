import type { NextRequest } from "next/server";
import { z } from "zod";
import { WEBHOOK_EVENT_STATUSES } from "@/server/modules/integration/domain/webhook-event";
import { handler, json } from "@/server/infrastructure/http/route-handler";

const query = z.object({
  status: z.enum(WEBHOOK_EVENT_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Webhooks recebidos do Omie, com a situação de cada um e o estado da fila. */
export const GET = handler(async (request, c) => {
  const filter = query.parse(Object.fromEntries((request as NextRequest).nextUrl.searchParams));
  const [result, queueCounts] = await Promise.all([c.webhookEvents.list({ ...filter, status: filter.status ?? null }), c.webhookQueue.counts()]);
  return json({
    ...result,
    page: filter.page,
    pageSize: filter.pageSize,
    queue: { mode: c.webhookQueue.mode, counts: queueCounts, available: queueCounts !== null, webhookEnabled: Boolean(c.config.OMIE_WEBHOOK_TOKEN) },
  });
});
