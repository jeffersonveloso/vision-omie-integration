import { Cron } from "croner";
import type { AppLogger } from "@/server/shared/application/ports";
import type { RunReconcileJob, RunSyncJob } from "@/server/modules/integration/application/use-cases/jobs";
import type { SweepWebhookEvents } from "@/server/modules/integration/application/use-cases/omie-webhooks";
import type { PurgeOldRecords } from "@/server/modules/integration/application/use-cases/purge-old-records";
import type { SchedulerControl } from "@/server/modules/settings/application/settings-service";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";

export const MAINTENANCE_CRON = "17 3 * * *";
export const WEBHOOK_SWEEP_CRON = "* * * * *";
/** Vigia (alertas de webhooks com problema e rotina parada): a cada 5 min, deslocado das rotinas. */
export const WATCHDOG_CRON = "2-59/5 * * * *";

interface JobState {
  name: string;
  cron: Cron | null;
  expression: string | null;
  enabled: boolean;
  lastRunAt: Date | null;
  busy: boolean;
}

/**
 * Agendador interno (cron). Lê as expressões da tela de Configurações e se recarrega
 * quando elas mudam. `protect` impede sobreposição; a trava no banco impede execução
 * duplicada entre várias instâncias.
 */
export class IntegrationScheduler implements SchedulerControl {
  private jobs = new Map<string, JobState>();
  private started = false;
  /** Rotinas em execução agora (para o desligamento esperar por elas). */
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    private readonly deps: {
      settings: SettingsRepository;
      sync: RunSyncJob;
      reconcile: RunReconcileJob;
      maintenance: PurgeOldRecords;
      webhookSweep: SweepWebhookEvents;
      /** Opcional para manter compatíveis os testes antigos do agendador. */
      watchdog?: { execute(): Promise<unknown> };
      logger: AppLogger;
      timeZone: string;
    },
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.reload();
    this.deps.logger.info("Agendador da integração iniciado", { jobs: this.status().jobs });
  }

  async reload(): Promise<void> {
    if (!this.started) return;
    for (const job of this.jobs.values()) job.cron?.stop();
    this.jobs.clear();
    const settings = await this.deps.settings.get();
    this.register("sync", settings.sync.enabled, settings.sync.cron, () => this.deps.sync.execute({ trigger: "SCHEDULE" }));
    this.register("reconcile", settings.reconcile.enabled, settings.reconcile.cron, () => this.deps.reconcile.execute({ trigger: "SCHEDULE" }));
    // Retenção dos logs: uma vez por dia, fora do horário comercial.
    this.register("maintenance", true, MAINTENANCE_CRON, () => this.deps.maintenance.execute());
    // Webhooks que não chegaram à fila (Redis fora do ar no recebimento) voltam para ela.
    this.register("webhooks", true, WEBHOOK_SWEEP_CRON, () => this.deps.webhookSweep.execute());
    if (this.deps.watchdog) this.register("watchdog", true, WATCHDOG_CRON, () => this.deps.watchdog!.execute());
  }

  stop(): void {
    for (const job of this.jobs.values()) job.cron?.stop();
    this.jobs.clear();
    this.started = false;
  }

  /**
   * Desligamento: não começa mais nenhuma rotina e espera as que estão rodando (até `timeoutMs`).
   * Devolve true se todas terminaram a tempo.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    this.stop();
    if (!this.running.size) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      Promise.allSettled([...this.running]).then(() => true),
      new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs))),
    ]);
    clearTimeout(timer);
    return finished;
  }

  private register(name: string, enabled: boolean, expression: string, task: () => Promise<unknown>): void {
    const state: JobState = { name, cron: null, expression, enabled, lastRunAt: null, busy: false };
    this.jobs.set(name, state);
    if (!enabled) return;
    try {
      state.cron = new Cron(
        expression,
        {
          timezone: this.deps.timeZone,
          protect: true,
          catch: (error) => this.deps.logger.error(`Falha na rotina agendada "${name}"`, { error: String(error) }),
        },
        async () => {
          state.busy = true;
          const run = task();
          this.running.add(run);
          try {
            await run;
          } finally {
            this.running.delete(run);
            state.busy = false;
            state.lastRunAt = new Date();
          }
        },
      );
    } catch (error) {
      state.enabled = false;
      this.deps.logger.error(`Expressão cron inválida para "${name}": ${expression}`, { error: String(error) });
    }
  }

  status() {
    return {
      running: this.started,
      jobs: [...this.jobs.values()].map((j) => ({
        name: j.name,
        cron: j.expression,
        enabled: j.enabled,
        nextRunAt: j.cron?.nextRun()?.toISOString() ?? null,
        lastRunAt: j.lastRunAt?.toISOString() ?? null,
        busy: j.busy,
      })),
    };
  }
}
