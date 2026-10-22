import type { AppLogger, Clock, IdGenerator } from "@/server/shared/application/ports";
import type { OmieAccountRepository } from "@/server/modules/omie-accounts/domain/omie-account-repository";
import type { IntegrationLogRepository, IntegrationOrderRepository } from "../../domain/repositories";
import { findOmieDocumentIds, readWebhookEnvelope, type WebhookEventRepository } from "../../domain/webhook-event";
import { ExecutionLog } from "../execution-log";
import type { WebhookJobContext, WebhookQueue } from "../ports";
import type { ReconcileOrder } from "./reconcile-order";

/**
 * 1) Recebimento (rota do webhook): grava e enfileira. Nada de chamar o Omie aqui — a resposta
 * precisa sair em poucos milissegundos, porque o Omie espera até 7 s e um POST lento segura os seguintes.
 * Se a fila estiver fora do ar, o evento fica gravado como RECEIVED e a varredura enfileira depois.
 */
export class ReceiveOmieWebhook {
  constructor(private readonly deps: { events: WebhookEventRepository; queue: WebhookQueue; ids: IdGenerator; clock: Clock; logger: AppLogger }) {}

  async execute(payload: unknown): Promise<{ eventId: string; duplicate: boolean; queued: boolean }> {
    const { events, queue, ids, clock, logger } = this.deps;
    const envelope = readWebhookEnvelope(payload);
    const now = clock.now();
    const { inserted, id } = await events.insert({
      id: ids.next(),
      source: "omie",
      ...envelope,
      omieAccountId: null,
      payload: payload ?? {},
      status: "RECEIVED",
      attempts: 0,
      note: null,
      lastError: null,
      relatedOrderId: null,
      receivedAt: now,
      enqueuedAt: null,
      processedAt: null,
    });
    if (!inserted) return { eventId: id, duplicate: true, queued: false };
    try {
      await queue.enqueue(id);
      await events.markQueued([id], now);
      return { eventId: id, duplicate: false, queued: true };
    } catch (error) {
      logger.warn("Webhook gravado, mas a fila está indisponível; a varredura vai enfileirar depois.", { eventId: id, error: String(error) });
      return { eventId: id, duplicate: false, queued: false };
    }
  }
}

/**
 * 2) Worker: acha o pedido citado no evento e consulta o Omie na hora (StatusPedido/StatusOS + títulos),
 * devolvendo ao Vision o que mudou. A consulta à API continua sendo a fonte da verdade, então eventos
 * repetidos ou fora de ordem não causam inconsistência.
 */
export class ProcessOmieWebhookEvent {
  constructor(
    private readonly deps: {
      events: WebhookEventRepository;
      orders: IntegrationOrderRepository;
      accounts: OmieAccountRepository;
      reconcile: ReconcileOrder;
      logs: IntegrationLogRepository;
      clock: Clock;
    },
  ) {}

  async execute(eventId: string, context: WebhookJobContext): Promise<void> {
    const { events, orders, accounts, reconcile, logs, clock } = this.deps;
    const event = await events.findById(eventId);
    if (!event || event.status === "DONE" || event.status === "IGNORED") return;
    await events.markProcessing(eventId, clock.now());
    try {
      let accountId: string | null = null;
      if (event.appKey) {
        const account = (await accounts.list()).find((a) => a.appKey === event.appKey);
        if (!account || !account.active) {
          await events.markFinished(eventId, { status: "IGNORED", note: account ? `A conta "${account.name}" está com a integração desativada.` : "A App Key do evento não pertence a nenhuma conta Omie cadastrada.", relatedOrderId: null, omieAccountId: account?.id ?? null }, clock.now());
          return;
        }
        accountId = account.id;
      }

      let order = null;
      for (const candidate of findOmieDocumentIds(event.payload)) {
        order = await orders.findByOmieDocumentId(candidate);
        if (order) break;
      }
      if (!order) {
        await events.markFinished(eventId, { status: "IGNORED", note: "Nenhum pedido da integração relacionado a este evento.", relatedOrderId: null, omieAccountId: accountId }, clock.now());
        return;
      }

      await orders.requestRecheck(order.id);
      const log = new ExecutionLog({ orderId: order.id, runId: null }, clock).step("CHECK_FISCAL");
      log.info(`Webhook do Omie (${event.topic ?? "sem tópico"}) recebido; consultando o Omie agora.`);
      await log.flush(logs);

      const outcome = await reconcile.execute({ orderId: order.id, runId: null });
      const note =
        outcome.status === "OK"
          ? outcome.returned
            ? `${outcome.returned} evento(s) devolvido(s) ao Vision.`
            : "Consulta feita; nada novo para devolver ao Vision."
          : outcome.status === "FAILED"
            ? `A consulta falhou e ficou registrada no pedido: ${outcome.error.message}`
            : `${outcome.reason} A rotina de retorno consulta o pedido em seguida.`;
      await events.markFinished(eventId, { status: "DONE", note, relatedOrderId: order.id, omieAccountId: accountId }, clock.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await events.markError(eventId, message, context.attempt >= context.maxAttempts);
      throw error; // a fila agenda a próxima tentativa
    }
  }
}

/** 3) Reprocessamento manual (tela): eventos com falha ou escolhidos voltam para a fila. */
export class RetryWebhookEvents {
  constructor(private readonly deps: { events: WebhookEventRepository; queue: WebhookQueue; clock: Clock }) {}

  async execute(input: { ids?: string[] }): Promise<{ queued: number }> {
    const { events, queue, clock } = this.deps;
    const ids = input.ids?.length ? input.ids : await events.listIdsByStatus("FAILED", 500);
    for (const id of ids) await queue.enqueue(id);
    await events.markQueued(ids, clock.now());
    return { queued: ids.length };
  }
}

/**
 * 4) Varredura (a cada minuto): enfileira o que não chegou à fila (Redis fora do ar no recebimento)
 * ou ficou parado. Reenfileirar o mesmo id não duplica o job.
 */
export class SweepWebhookEvents {
  constructor(private readonly deps: { events: WebhookEventRepository; queue: WebhookQueue; clock: Clock; logger: AppLogger }) {}

  async execute(): Promise<number> {
    const { events, queue, clock, logger } = this.deps;
    const now = clock.now();
    const stale = await events.listStale(new Date(now.getTime() - 2 * 60_000), 200);
    let queued = 0;
    for (const id of stale) {
      try {
        await queue.enqueue(id);
        queued++;
      } catch (error) {
        logger.warn("Fila de webhooks indisponível na varredura", { error: String(error) });
        break;
      }
    }
    if (queued) await events.markQueued(stale.slice(0, queued), now);
    return queued;
  }
}
