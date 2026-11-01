import type { Clock, IdGenerator } from "@/server/shared/application/ports";
import { addDays, toIsoDate } from "@/server/shared/domain/dates";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";
import { IntegrationOrder } from "../../domain/integration-order";
import type { CheckpointRepository, IntegrationLogRepository, IntegrationOrderRepository } from "../../domain/repositories";
import { parseVisionOrderSummary, type VisionOrderSummary } from "../../domain/vision-order";
import { isIntegrationError } from "../../domain/integration-error";
import { ExecutionLog } from "../execution-log";
import type { VisionGateway } from "../ports";

export const VISION_CHECKPOINT_KEY = "vision.orders.updated";

export interface CollectionCheckpoint {
  lastUpdatedAt: string;
  lastRunTo: string;
}

/**
 * Início da janela da próxima coleta: sem checkpoint, `initialLookbackDays` para trás;
 * depois, a maior data de atualização já vista menos a sobreposição.
 */
export function nextWindowFrom(checkpoint: CollectionCheckpoint | null, sync: { initialLookbackDays: number; overlapDays: number }, now: Date, timeZone: string): string {
  return checkpoint
    ? toIsoDate(addDays(new Date(checkpoint.lastUpdatedAt), -sync.overlapDays), timeZone)
    : toIsoDate(addDays(now, -sync.initialLookbackDays), timeZone);
}

export interface CollectResult {
  windowFrom: string;
  windowTo: string;
  fetched: number;
  discovered: number;
  updated: number;
  updatedAfterSync: number;
  unchanged: number;
  /** Pedidos da integração que entraram ou foram atualizados nesta coleta. */
  orderIds: string[];
}

export interface UpsertResult {
  discovered: number;
  updated: number;
  updatedAfterSync: number;
  unchanged: number;
  /** Ids dos pedidos da integração, na ordem dos resumos. */
  orderIds: string[];
}

export interface ImportByCodesResult extends UpsertResult {
  fetched: number;
  /** Códigos que o Vision não encontrou. */
  notFound: number[];
  /** Pedidos fora das situações elegíveis (não entraram na fila). */
  notEligible: Array<{ code: number; statusCode: number | null; statusDescription: string | null }>;
}

/** Campos do pedido completo guardados como resumo (o pedido inteiro fica em visionPayload no envio). */
const SUMMARY_FIELDS = ["codigo", "codigoPedido", "codigoEmpresa", "codigoStatus", "descricaoStatus", "dataAtualizacao"];

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

  async execute(input: { runId: string | null; from?: string; to?: string; updateCheckpoint?: boolean }): Promise<CollectResult> {
    const { vision, orders, checkpoints, settings: settingsRepo, logs, ids, clock, timeZone } = this.deps;
    const settings = await settingsRepo.get();
    const now = clock.now();
    const checkpoint = await checkpoints.get<CollectionCheckpoint>(VISION_CHECKPOINT_KEY);
    const runLog = new ExecutionLog({ orderId: null, runId: input.runId }, clock).step("COLLECT");

    const windowTo = input.to ?? toIsoDate(now, timeZone);
    const windowFrom = input.from ?? nextWindowFrom(checkpoint, settings.sync, now, timeZone);

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

      let maxUpdated: Date | null = checkpoint ? new Date(checkpoint.lastUpdatedAt) : null;
      for (const summary of collected.values()) if (summary.updatedAt && (!maxUpdated || summary.updatedAt > maxUpdated)) maxUpdated = summary.updatedAt;
      const upserted = await this.upsertSummaries([...collected.values()], input.runId);
      const result: CollectResult = { windowFrom, windowTo, fetched: collected.size, discovered: upserted.discovered, updated: upserted.updated, updatedAfterSync: upserted.updatedAfterSync, unchanged: upserted.unchanged, orderIds: upserted.orderIds };

      // Coleta de um período escolhido à mão não mexe no ponto em que a coleta automática está.
      if (input.updateCheckpoint === false) {
        runLog.info(`Coleta manual do período ${windowFrom} a ${windowTo}: ${result.fetched} pedido(s); ${result.discovered} novo(s).`, { ...result, orderIds: undefined });
        return result;
      }
      await checkpoints.set<CollectionCheckpoint>(VISION_CHECKPOINT_KEY, {
        lastUpdatedAt: (maxUpdated ?? now).toISOString(),
        lastRunTo: windowTo,
      });
      runLog.info(`Coleta concluída: ${result.fetched} pedido(s) no período ${windowFrom} a ${windowTo}; ${result.discovered} novo(s).`, { ...result, orderIds: undefined });
      return result;
    } finally {
      await runLog.flush(logs);
    }
  }

  /** Registra pedidos novos na fila e atualiza os já conhecidos (o mesmo para a coleta e a importação). */
  private async upsertSummaries(summaries: VisionOrderSummary[], runId: string | null): Promise<UpsertResult> {
    const { orders, logs, ids, clock } = this.deps;
    const now = clock.now();
    const existing = await orders.findByVisionCodes(summaries.map((s) => s.code));
    const result: UpsertResult = { discovered: 0, updated: 0, updatedAfterSync: 0, unchanged: 0, orderIds: [] };
    for (const summary of summaries) {
      const order = existing.get(summary.code);
      if (!order) {
        const created = IntegrationOrder.discover(summary, ids.next(), now);
        await orders.save(created);
        result.discovered++;
        result.orderIds.push(created.id);
        const orderLog = new ExecutionLog({ orderId: created.id, runId }, clock).step("COLLECT");
        orderLog.info(`Pedido ${summary.code} encontrado no Vision e adicionado à fila.`, { resumo: summary.raw });
        await orderLog.flush(logs);
        continue;
      }
      result.orderIds.push(order.id);
      const change = order.refreshSummary(summary, now);
      if (change === "UNCHANGED") {
        result.unchanged++;
        continue;
      }
      await orders.save(order);
      const orderLog = new ExecutionLog({ orderId: order.id, runId }, clock).step("COLLECT");
      if (change === "UPDATED_AFTER_SYNC") {
        result.updatedAfterSync++;
        orderLog.warn("Pedido alterado no Vision depois de enviado ao Omie. Confira se o documento no Omie precisa de ajuste manual.", { resumo: summary.raw });
      } else {
        result.updated++;
        orderLog.info("Pedido atualizado no Vision antes do envio; a próxima tentativa usará os dados novos.");
      }
      await orderLog.flush(logs);
    }
    return result;
  }

  /**
   * Traz pedidos específicos pelo código (homologação, pedido que ficou de fora de uma janela).
   * Respeita as situações elegíveis, a não ser que `includeIneligible` seja verdadeiro.
   * Não mexe no ponto em que a coleta automática está.
   */
  async importByCodes(input: { codes: number[]; runId: string | null; includeIneligible?: boolean }): Promise<ImportByCodesResult> {
    const { vision, settings: settingsRepo, logs, clock } = this.deps;
    const settings = await settingsRepo.get();
    const eligible = settings.sync.eligibleStatusCodes;
    const runLog = new ExecutionLog({ orderId: null, runId: input.runId }, clock).step("COLLECT");
    const recorder = runLog.recorder();
    const summaries: VisionOrderSummary[] = [];
    const notFound: number[] = [];
    const notEligible: ImportByCodesResult["notEligible"] = [];
    try {
      for (const code of [...new Set(input.codes)]) {
        let payload: Record<string, unknown>;
        try {
          payload = (await vision.getOrder(code, recorder)) as Record<string, unknown>;
        } catch (error) {
          // 404 do Vision ou resposta sem o pedido: o código não existe (ou não está liberado).
          if (isIntegrationError(error) && (error.code === "ORDER_NOT_FOUND" || error.code === "HTTP_404")) {
            notFound.push(code);
            continue;
          }
          throw error;
        }
        const raw = Object.fromEntries(SUMMARY_FIELDS.filter((k) => payload[k] !== undefined).map((k) => [k, payload[k]]));
        const summary = parseVisionOrderSummary(raw);
        if (!summary) {
          notFound.push(code);
          continue;
        }
        if (!input.includeIneligible && eligible.length && (summary.statusCode === null || !eligible.includes(summary.statusCode))) {
          notEligible.push({ code: summary.code, statusCode: summary.statusCode, statusDescription: summary.statusDescription });
          continue;
        }
        summaries.push(summary);
      }
      const upserted = await this.upsertSummaries(summaries, input.runId);
      const result: ImportByCodesResult = { fetched: summaries.length, notFound, notEligible, ...upserted };
      runLog.info(`Importação por código: ${summaries.length} pedido(s) trazido(s) do Vision; ${upserted.discovered} novo(s).`, { ...result, orderIds: undefined });
      return result;
    } finally {
      await runLog.flush(logs);
    }
  }
}
