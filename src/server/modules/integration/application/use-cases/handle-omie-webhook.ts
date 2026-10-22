import type { Clock, IdGenerator } from "@/server/shared/application/ports";
import type { IntegrationLogRepository, IntegrationOrderRepository } from "../../domain/repositories";
import { ExecutionLog } from "../execution-log";

export interface WebhookEventStore {
  save(event: { id: string; source: string; topic: string | null; payload: unknown; receivedAt: Date; relatedOrderId: string | null }): Promise<void>;
  purgeBefore(date: Date): Promise<number>;
}

const ID_KEYS = ["idPedido", "codigo_pedido", "nCodPed", "nCodPedido", "idOrdemServico", "nCodOS", "codigoPedido"];

function findCandidateIds(value: unknown, depth = 0, out = new Set<number>()): Set<number> {
  if (depth > 5 || !value || typeof value !== "object") return out;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (ID_KEYS.includes(key)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out.add(n);
    } else if (v && typeof v === "object") findCandidateIds(v, depth + 1, out);
  }
  return out;
}

/**
 * Webhook do Omie (opcional): acelera o retorno ao Vision. O evento é gravado e o pedido
 * relacionado é marcado para consulta imediata — a fonte da verdade continua sendo a consulta
 * à API (StatusPedido/StatusOS), então eventos fora de ordem não causam inconsistência.
 */
export class HandleOmieWebhook {
  constructor(
    private readonly deps: { orders: IntegrationOrderRepository; events: WebhookEventStore; logs: IntegrationLogRepository; ids: IdGenerator; clock: Clock },
  ) {}

  async execute(payload: unknown): Promise<{ relatedOrderId: string | null }> {
    const { orders, events, logs, ids, clock } = this.deps;
    const topic = payload && typeof payload === "object" ? String((payload as Record<string, unknown>).topic ?? "") || null : null;
    let relatedOrderId: string | null = null;
    for (const candidate of findCandidateIds(payload)) {
      const order = await orders.findByOmieDocumentId(candidate);
      if (order) {
        relatedOrderId = order.id;
        await orders.requestRecheck(order.id);
        const log = new ExecutionLog({ orderId: order.id, runId: null }, clock).step("CHECK_FISCAL");
        log.info(`Webhook do Omie recebido (${topic ?? "sem tópico"}); pedido marcado para consulta imediata.`);
        await log.flush(logs);
        break;
      }
    }
    await events.save({ id: ids.next(), source: "omie", topic, payload, receivedAt: clock.now(), relatedOrderId });
    return { relatedOrderId };
  }
}
