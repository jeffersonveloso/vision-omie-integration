import type { Clock, IdGenerator } from "@/server/shared/application/ports";
import { addDays, toIsoDate } from "@/server/shared/domain/dates";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";
import { IntegrationOrder } from "../../domain/integration-order";
import type { CheckpointRepository, IntegrationLogRepository, IntegrationOrderRepository } from "../../domain/repositories";
import type { VisionOrderSummary } from "../../domain/vision-order";
import { ExecutionLog } from "../execution-log";
import type { VisionGateway } from "../ports";

export const VISION_CHECKPOINT_KEY = "vision.orders.updated";

interface Checkpoint {
  lastUpdatedAt: string;
  lastRunTo: string;
}

export interface CollectResult {
  windowFrom: string;
  windowTo: string;
  fetched: number;
  discovered: number;
  updated: number;
  updatedAfterSync: number;
  unchanged: number;
}

const MAX_PAGES = 500;

/**
 * Etapas 1–2 do fluxo: consulta incremental de pedidos atualizados no Vision
 * (por período, situação e paginação) e registro dos novos pedidos na fila.
 */
export class CollectVisionOrders {
  constructor(
    private readonly deps: {
      vision: VisionGateway;
      orders: IntegrationOrderRepository;
      checkpoints: CheckpointRepository;
      settings: SettingsRepository;
      logs: IntegrationLogRepository;
      ids: IdGenerator;
      clock: Clock;
      timeZone: string;
    },
  ) {}

  async execute(input: { runId: string | null; from?: string; to?: string }): Promise<CollectResult> {
    const { vision, orders, checkpoints, settings: settingsRepo, logs, ids, clock, timeZone } = this.deps;
    const settings = await settingsRepo.get();
    const now = clock.now();
    const checkpoint = await checkpoints.get<Checkpoint>(VISION_CHECKPOINT_KEY);
    const runLog = new ExecutionLog({ orderId: null, runId: input.runId }, clock).step("COLLECT");

    const windowTo = input.to ?? toIsoDate(now, timeZone);
    const windowFrom =
      input.from ??
      (checkpoint
        ? toIsoDate(addDays(new Date(checkpoint.lastUpdatedAt), -settings.sync.overlapDays), timeZone)
        : toIsoDate(addDays(now, -settings.sync.initialLookbackDays), timeZone));

    const statuses: Array<number | null> = settings.sync.eligibleStatusCodes.length ? settings.sync.eligibleStatusCodes : [null];
    const collected = new Map<number, VisionOrderSummary>();
    const recorder = runLog.recorder();

    try {
      for (const status of statuses) {
        for (let page = 1; page <= MAX_PAGES; page++) {
          const result = await vision.listUpdatedOrders(
            { dataInicial: windowFrom, dataFinal: windowTo, codigoStatus: status, pagina: page, linhas: settings.sync.pageSize },
            recorder,
          );
          for (const summary of result.orders) {
            const current = collected.get(summary.code);
            if (!current || (summary.updatedAt?.getTime() ?? 0) >= (current.updatedAt?.getTime() ?? 0)) collected.set(summary.code, summary);
          }
          // O Vision informa TotalPaginas; sem ele, para quando a página vier incompleta
          // (comparando com as linhas que o Vision usou, que podem diferir das pedidas).
          const lastPage = result.totalPages !== null ? page >= result.totalPages : result.orders.length < (result.pageSize ?? settings.sync.pageSize);
          if (lastPage || result.orders.length === 0) break;
        }
      }

      const existing = await orders.findByVisionCodes([...collected.keys()]);
      const result: CollectResult = { windowFrom, windowTo, fetched: collected.size, discovered: 0, updated: 0, updatedAfterSync: 0, unchanged: 0 };
      let maxUpdated: Date | null = checkpoint ? new Date(checkpoint.lastUpdatedAt) : null;

      for (const summary of collected.values()) {
        if (summary.updatedAt && (!maxUpdated || summary.updatedAt > maxUpdated)) maxUpdated = summary.updatedAt;
        const order = existing.get(summary.code);
        if (!order) {
          const created = IntegrationOrder.discover(summary, ids.next(), now);
          await orders.save(created);
          result.discovered++;
          const orderLog = new ExecutionLog({ orderId: created.id, runId: input.runId }, clock).step("COLLECT");
          orderLog.info(`Pedido ${summary.code} encontrado no Vision e adicionado à fila.`, { resumo: summary.raw });
          await orderLog.flush(logs);
          continue;
        }
        const change = order.refreshSummary(summary, now);
        if (change === "UNCHANGED") {
          result.unchanged++;
          continue;
        }
        await orders.save(order);
        const orderLog = new ExecutionLog({ orderId: order.id, runId: input.runId }, clock).step("COLLECT");
        if (change === "UPDATED_AFTER_SYNC") {
          result.updatedAfterSync++;
          orderLog.warn("Pedido alterado no Vision depois de enviado ao Omie. Confira se o documento no Omie precisa de ajuste manual.", { resumo: summary.raw });
        } else {
          result.updated++;
          orderLog.info("Pedido atualizado no Vision antes do envio; a próxima tentativa usará os dados novos.");
        }
        await orderLog.flush(logs);
      }

      await checkpoints.set<Checkpoint>(VISION_CHECKPOINT_KEY, {
        lastUpdatedAt: (maxUpdated ?? now).toISOString(),
        lastRunTo: windowTo,
      });
      runLog.info(`Coleta concluída: ${result.fetched} pedido(s) no período ${windowFrom} a ${windowTo}; ${result.discovered} novo(s).`, { ...result });
      return result;
    } finally {
      await runLog.flush(logs);
    }
  }
}
