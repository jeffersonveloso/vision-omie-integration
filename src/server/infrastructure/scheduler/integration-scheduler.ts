import { Cron } from "croner";
import type { AppLogger } from "@/server/shared/application/ports";
import type { RunReconcileJob, RunSyncJob } from "@/server/modules/integration/application/use-cases/jobs";
import type { SchedulerControl } from "@/server/modules/settings/application/settings-service";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";

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

  constructor(
    private readonly deps: {
      settings: SettingsRepository;
      sync: RunSyncJob;
      reconcile: RunReconcileJob;
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
  }

  stop(): void {
    for (const job of this.jobs.values()) job.cron?.stop();
    this.jobs.clear();
    this.started = false;
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
          try {
            await task();
          } finally {
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
