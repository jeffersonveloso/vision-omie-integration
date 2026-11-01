import type { AppLogger, Clock, IdGenerator } from "@/server/shared/application/ports";
import { ConflictError } from "@/server/shared/domain/result";
import { addDays } from "@/server/shared/domain/dates";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";
import type { IntegrationOrderRepository, JobLock, SyncRun, SyncRunRepository, SyncTrigger } from "../../domain/repositories";
import type { CollectVisionOrders } from "./collect-vision-orders";
import type { ProcessOrder } from "./process-order";
import type { ReconcileOrder } from "./reconcile-order";
import type { RunNotice, RunNotifier } from "../ports";

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

interface JobDeps {
  orders: IntegrationOrderRepository;
  runs: SyncRunRepository;
  lock: JobLock;
  settings: SettingsRepository;
  ids: IdGenerator;
  clock: Clock;
  logger: AppLogger;
  instanceId: string;
  /** Alertas (Slack) ao fim da execução. Opcional. */
  notifier?: RunNotifier;
}

/**
 * Rotina agendada principal: coleta incremental no Vision + envio dos pedidos da fila
 * + novas tentativas automáticas vencidas. Protegida por trava para não sobrepor execuções.
 */
export class RunSyncJob {
  constructor(private readonly deps: JobDeps & { collect: CollectVisionOrders; process: ProcessOrder }) {}

  async execute(input: { trigger: SyncTrigger; collect?: boolean }): Promise<SyncRun> {
    const { orders, runs, lock, settings: settingsRepo, ids, clock, logger, instanceId, collect, process } = this.deps;
    const settings = await settingsRepo.get();
    const run: SyncRun = { id: ids.next(), job: "SYNC", trigger: input.trigger, status: "RUNNING", startedAt: clock.now(), finishedAt: null, windowFrom: null, windowTo: null, stats: {}, error: null };

    if (!(await lock.tryAcquire("sync", instanceId, 30 * 60_000))) {
      return { ...run, status: "SKIPPED", finishedAt: clock.now(), error: "Outra sincronização já está em andamento." };
    }
    await runs.create(run);
    const errors: string[] = [];
    const notice: Omit<RunNotice, "run"> = { failures: [], rejections: [] };
    try {
      if (input.collect !== false) {
        try {
          const collected = await collect.execute({ runId: run.id });
          run.windowFrom = collected.windowFrom;
          run.windowTo = collected.windowTo;
          run.stats = { ...run.stats, fetched: collected.fetched, discovered: collected.discovered, updated: collected.updated + collected.updatedAfterSync };
        } catch (error) {
          errors.push(`Coleta no Vision falhou: ${error instanceof Error ? error.message : String(error)}`);
          logger.error("Falha na coleta do Vision", { error: String(error) });
        }
      }

      const due = await orders.listDueForProcessing(clock.now(), settings.sync.maxOrdersPerRun, settings.retry.maxAutoRetries + 1);
      let succeeded = 0;
      let failed = 0;
      await runPool(due, settings.sync.concurrency, async (orderId) => {
        const outcome = await process.execute({ orderId, runId: run.id, trigger: "SCHEDULE" });
        if (outcome.status === "SENT") succeeded++;
        if (outcome.status === "FAILED") {
          failed++;
          if (outcome.newError) notice.failures.push({ orderId, visionOrderCode: outcome.visionOrderCode, category: outcome.error.category, message: outcome.error.message });
        }
      });
      run.stats = { ...run.stats, processed: due.length, succeeded, failed };
      run.status = errors.length ? (due.length ? "PARTIAL" : "FAILED") : failed > 0 ? "PARTIAL" : "SUCCESS";
      run.error = errors.join(" | ") || null;
    } catch (error) {
      run.status = "FAILED";
      run.error = error instanceof Error ? error.message : String(error);
      logger.error("Falha na rotina de sincronização", { error: run.error });
    } finally {
      run.finishedAt = clock.now();
      await runs.update(run);
      await lock.release("sync", instanceId);
    }
    await this.deps.notifier?.notifyRun({ run, ...notice });
    return run;
  }
}

/** Rotina agendada de retorno: acompanha NF/títulos no Omie e devolve os eventos ao Vision. */
export class RunReconcileJob {
  constructor(private readonly deps: JobDeps & { reconcile: ReconcileOrder }) {}

  async execute(input: { trigger: SyncTrigger }): Promise<SyncRun> {
    const { orders, runs, lock, settings: settingsRepo, ids, clock, logger, instanceId, reconcile } = this.deps;
    const settings = await settingsRepo.get();
    const run: SyncRun = { id: ids.next(), job: "RECONCILE", trigger: input.trigger, status: "RUNNING", startedAt: clock.now(), finishedAt: null, windowFrom: null, windowTo: null, stats: {}, error: null };
    if (!(await lock.tryAcquire("reconcile", instanceId, 60 * 60_000))) {
      return { ...run, status: "SKIPPED", finishedAt: clock.now(), error: "Outro acompanhamento já está em andamento." };
    }
    await runs.create(run);
    const notice: Omit<RunNotice, "run"> = { failures: [], rejections: [] };
    try {
      const since = addDays(clock.now(), -settings.reconcile.windowDays);
      const due = await orders.listDueForReconcile(clock.now(), since, settings.reconcile.maxOrdersPerRun);
      let returned = 0;
      let failed = 0;
      let changed = 0;
      await runPool(due, Math.min(2, settings.sync.concurrency), async (orderId) => {
        const outcome = await reconcile.execute({ orderId, runId: run.id });
        if (outcome.status === "OK") {
          returned += outcome.returned;
          if (outcome.changed) changed++;
          if (outcome.rejection) notice.rejections.push({ orderId, visionOrderCode: outcome.visionOrderCode, message: outcome.rejection });
        }
        if (outcome.status === "FAILED") {
          failed++;
          if (outcome.newError) notice.failures.push({ orderId, visionOrderCode: outcome.visionOrderCode, category: outcome.error.category, message: outcome.error.message });
        }
      });
      run.stats = { checked: due.length, changed, returned, failed };
      run.status = failed > 0 ? "PARTIAL" : "SUCCESS";
    } catch (error) {
      run.status = "FAILED";
      run.error = error instanceof Error ? error.message : String(error);
      logger.error("Falha na rotina de retorno", { error: run.error });
    } finally {
      run.finishedAt = clock.now();
      await runs.update(run);
      await lock.release("reconcile", instanceId);
    }
    await this.deps.notifier?.notifyRun({ run, ...notice });
    return run;
  }
}

export interface ImportRequest {
  /** Códigos de pedido do Vision. */
  codes?: number[];
  /** Período de atualização no Vision (aaaa-mm-dd), quando não há códigos. */
  from?: string;
  to?: string;
  /** Envia ao Omie logo depois de trazer (só pedidos na fila ou com erro). */
  process: boolean;
  /** Traz pedidos pelo código mesmo fora das situações elegíveis. */
  includeIneligible?: boolean;
}

export interface ImportOutcome {
  run: SyncRun;
  fetched: number;
  discovered: number;
  updated: number;
  unchanged: number;
  notFound: number[];
  notEligible: Array<{ code: number; statusCode: number | null; statusDescription: string | null }>;
  processed: number;
  succeeded: number;
  failed: number;
  orderIds: string[];
  /** Situação final dos pedidos trazidos (até 200), para a tela mostrar e abrir cada um. */
  orders: Array<{ id: string; visionOrderCode: number; status: string; lastError: string | null }>;
}

/**
 * Traz pedidos do Vision fora da coleta automática: pelo código ou por um período escolhido. Não move o
 * ponto em que a coleta automática está. Usa a mesma trava da sincronização para não disputar pedidos.
 */
export class ImportVisionOrders {
  constructor(private readonly deps: JobDeps & { collect: CollectVisionOrders; process: ProcessOrder }) {}

  async execute(input: ImportRequest, actor: string | null = null): Promise<ImportOutcome> {
    const { orders, runs, lock, settings: settingsRepo, ids, clock, logger, instanceId, collect, process } = this.deps;
    const settings = await settingsRepo.get();
    if (!(await lock.tryAcquire("sync", instanceId, 30 * 60_000))) {
      throw new ConflictError("Uma coleta ou importação já está em andamento. Tente de novo em instantes.");
    }
    const run: SyncRun = { id: ids.next(), job: "SYNC", trigger: "MANUAL", status: "RUNNING", startedAt: clock.now(), finishedAt: null, windowFrom: input.codes?.length ? null : (input.from ?? null), windowTo: input.codes?.length ? null : (input.to ?? null), stats: {}, error: null };
    await runs.create(run);
    const outcome: ImportOutcome = { run, fetched: 0, discovered: 0, updated: 0, unchanged: 0, notFound: [], notEligible: [], processed: 0, succeeded: 0, failed: 0, orderIds: [], orders: [] };
    const notice: Omit<RunNotice, "run"> = { failures: [], rejections: [] };
    try {
      if (input.codes?.length) {
        const r = await collect.importByCodes({ codes: input.codes, runId: run.id, includeIneligible: input.includeIneligible });
        Object.assign(outcome, { fetched: r.fetched, discovered: r.discovered, updated: r.updated + r.updatedAfterSync, unchanged: r.unchanged, notFound: r.notFound, notEligible: r.notEligible, orderIds: r.orderIds });
      } else {
        const r = await collect.execute({ runId: run.id, from: input.from, to: input.to, updateCheckpoint: false });
        Object.assign(outcome, { fetched: r.fetched, discovered: r.discovered, updated: r.updated + r.updatedAfterSync, unchanged: r.unchanged, orderIds: r.orderIds });
      }

      if (input.process) {
        const due: string[] = [];
        for (const id of outcome.orderIds) {
          const order = await orders.findById(id);
          if (order && !order.ignored && (order.status === "PENDING" || order.status === "ERROR")) due.push(id);
        }
        const limited = due.slice(0, settings.sync.maxOrdersPerRun);
        await runPool(limited, settings.sync.concurrency, async (orderId) => {
          const result = await process.execute({ orderId, runId: run.id, trigger: "MANUAL", actor });
          if (result.status === "SENT") outcome.succeeded++;
          if (result.status === "FAILED") {
            outcome.failed++;
            if (result.newError) notice.failures.push({ orderId, visionOrderCode: result.visionOrderCode, category: result.error.category, message: result.error.message });
          }
        });
        outcome.processed = limited.length;
      }
      for (const id of outcome.orderIds.slice(0, 200)) {
        const order = await orders.findById(id);
        if (order) outcome.orders.push({ id, visionOrderCode: order.visionOrderCode, status: order.status, lastError: order.lastError?.message ?? null });
      }
      run.stats = { fetched: outcome.fetched, discovered: outcome.discovered, updated: outcome.updated, processed: outcome.processed, succeeded: outcome.succeeded, failed: outcome.failed };
      run.status = outcome.failed > 0 || outcome.notFound.length > 0 ? "PARTIAL" : "SUCCESS";
      run.error = outcome.notFound.length ? `Não encontrado(s) no Vision: ${outcome.notFound.join(", ")}` : null;
    } catch (error) {
      run.status = "FAILED";
      run.error = error instanceof Error ? error.message : String(error);
      logger.error("Falha ao trazer pedidos do Vision", { error: run.error });
      throw error;
    } finally {
      run.finishedAt = clock.now();
      await runs.update(run);
      await lock.release("sync", instanceId);
      await this.deps.notifier?.notifyRun({ run, ...notice }).catch(() => undefined);
    }
    return outcome;
  }
}
