import type { NextRequest } from "next/server";
import { handler, json } from "@/server/infrastructure/http/route-handler";

/**
 * Webhook do Omie. Configure no Developer Omie a URL
 * https://<sua-integração>/api/webhooks/omie?token=<OMIE_WEBHOOK_TOKEN>.
 *
 * O Omie espera 2xx em até 7 s e entrega os eventos de cada aplicativo em fila: um POST lento ou com erro
 * segura os seguintes. Por isso aqui só gravamos o evento e o colocamos na fila (Redis/BullMQ);
 * o worker acha o pedido e consulta o Omie. Evento repetido (mesmo messageId) responde 200 sem duplicar.
 * Não usa o login: o Omie se identifica pelo token da URL.
 */
export const POST = handler(async (request, c) => {
  const token = (request as NextRequest).nextUrl.searchParams.get("token");
  if (!c.config.OMIE_WEBHOOK_TOKEN || token !== c.config.OMIE_WEBHOOK_TOKEN) {
    return json({ error: { code: "UNAUTHORIZED", message: "Webhook desativado ou token inválido." } }, { status: 401 });
  }
  const payload = await request.json().catch(() => ({}));
  const result = await c.useCases.receiveWebhook.execute(payload);
  return json({ ok: true, ...result });
}, { access: "public" });
