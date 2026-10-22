import type { NextRequest } from "next/server";
import { handler, json } from "@/server/infrastructure/http/route-handler";

/**
 * Webhook do Omie (opcional). Configure no Developer Omie a URL
 * https://<sua-integração>/api/webhooks/omie?token=<OMIE_WEBHOOK_TOKEN>.
 * Responde 200 rápido (o Omie espera ≤ 7 s) e dispara a consulta do pedido em segundo plano.
 */
export const POST = handler(async (request, c) => {
  const token = (request as NextRequest).nextUrl.searchParams.get("token");
  if (!c.config.OMIE_WEBHOOK_TOKEN || token !== c.config.OMIE_WEBHOOK_TOKEN) {
    return json({ error: { code: "UNAUTHORIZED", message: "Webhook desativado ou token inválido." } }, { status: 401 });
  }
  const payload = await request.json().catch(() => ({}));
  const { relatedOrderId } = await c.useCases.webhook.execute(payload);
  if (relatedOrderId) {
    void c.useCases.reconcileOrder.execute({ orderId: relatedOrderId, runId: null }).catch((error) => c.logger.error("Falha no retorno disparado por webhook", { error: String(error) }));
  }
  return json({ ok: true, relatedOrderId });
});
