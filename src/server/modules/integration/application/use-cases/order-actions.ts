import type { Clock } from "@/server/shared/application/ports";
import { NotFoundError } from "@/server/shared/domain/result";
import type { ErrorCategory } from "../../domain/integration-error";
import type { IntegrationLogRepository, IntegrationOrderRepository } from "../../domain/repositories";
import { ExecutionLog } from "../execution-log";
import type { ProcessOrder, ProcessOutcome } from "./process-order";
import type { ReconcileOrder, ReconcileOutcome } from "./reconcile-order";

export interface RetryResult {
  orderId: string;
  process?: ProcessOutcome;
  reconcile?: ReconcileOutcome;
  ok: boolean;
  message: string;
}

/**
 * Reenvio manual pela plataforma: executa a etapa pendente do pedido (envio ao Omie
 * e/ou retorno ao Vision) imediatamente, com os dados e mapeamentos atuais.
 */
export class RetryOrder {
  constructor(
    private readonly deps: { orders: IntegrationOrderRepository; process: ProcessOrder; reconcile: ReconcileOrder; logs: IntegrationLogRepository; clock: Clock },
  ) {}

  async execute(input: { orderId: string; actor?: string | null }): Promise<RetryResult> {
    const { orders, process, reconcile, clock } = this.deps;
    const order = await orders.findById(input.orderId);
    if (!order) throw new NotFoundError("Pedido", input.orderId);
    order.prepareManualRetry(clock.now());
    await orders.save(order);

    const result: RetryResult = { orderId: order.id, ok: true, message: "" };
    if (order.hasUnsentDocuments() || order.lastErrorScope() === "SEND") {
      result.process = await process.execute({ orderId: order.id, runId: null, trigger: "MANUAL", actor: input.actor ?? null });
      if (result.process.status === "FAILED") {
        return { ...result, ok: false, message: result.process.error.message };
      }
      if (result.process.status === "SKIPPED") return { ...result, ok: false, message: result.process.reason };
    }
    const refreshed = await orders.findById(order.id);
    if (refreshed?.hasSentDocuments()) {
      result.reconcile = await reconcile.execute({ orderId: order.id, runId: null });
      if (result.reconcile.status === "FAILED") return { ...result, ok: false, message: result.reconcile.error.message };
    }
    return { ...result, message: "Pedido reprocessado com sucesso." };
  }
}

/** Reenvio em massa (ex.: todos os erros de mapeamento depois de cadastrar os de-para). */
export class RetryOrders {
  constructor(private readonly deps: { orders: IntegrationOrderRepository; retry: RetryOrder }) {}

  async execute(input: { ids?: string[]; category?: ErrorCategory; omieAccountId?: string; limit?: number; actor?: string | null }): Promise<{ total: number; succeeded: number; failed: number; results: RetryResult[] }> {
    const ids = await this.deps.orders.listIdsForBulkRetry({ ids: input.ids, category: input.category, omieAccountId: input.omieAccountId }, Math.min(input.limit ?? 100, 500));
    const results: RetryResult[] = [];
    for (const id of ids) {
      try {
        results.push(await this.deps.retry.execute({ orderId: id, actor: input.actor }));
      } catch (error) {
        results.push({ orderId: id, ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { total: ids.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }
}

/** Ignorar / voltar a integrar um pedido (ex.: pedido de teste ou lançado manualmente no Omie). */
export class SetOrderIgnored {
  constructor(private readonly deps: { orders: IntegrationOrderRepository; logs: IntegrationLogRepository; clock: Clock }) {}

  async execute(input: { orderId: string; ignored: boolean; reason?: string | null; actor?: string | null }): Promise<void> {
    const { orders, logs, clock } = this.deps;
    const order = await orders.findById(input.orderId);
    if (!order) throw new NotFoundError("Pedido", input.orderId);
    if (input.ignored) order.ignore(clock.now());
    else order.unignore(clock.now());
    await orders.save(order);
    const log = new ExecutionLog({ orderId: order.id, runId: null }, clock);
    const by = input.actor ? ` por ${input.actor}` : "";
    log.add(input.ignored ? "WARN" : "INFO", input.ignored ? `Pedido marcado como ignorado${by}${input.reason ? `: ${input.reason}` : "."}` : `Pedido voltou para a integração${by}.`, null, null);
    await log.flush(logs);
  }
}

/** Marca como ciente o aviso "pedido alterado no Vision após o envio". */
export class AcknowledgeVisionUpdate {
  constructor(private readonly deps: { orders: IntegrationOrderRepository; clock: Clock }) {}

  async execute(input: { orderId: string }): Promise<void> {
    const order = await this.deps.orders.findById(input.orderId);
    if (!order) throw new NotFoundError("Pedido", input.orderId);
    order.acknowledgeVisionUpdate(this.deps.clock.now());
    await this.deps.orders.save(order);
  }
}
