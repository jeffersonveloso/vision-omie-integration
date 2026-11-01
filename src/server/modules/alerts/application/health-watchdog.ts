import { Cron } from "croner";
import type { Clock } from "@/server/shared/application/ports";
import type { CheckpointRepository, SyncJob, SyncRunRepository } from "@/server/modules/integration/domain/repositories";
import type { WebhookEventRepository } from "@/server/modules/integration/domain/webhook-event";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";

/** Webhook que não terminou depois deste tempo indica worker parado ou Redis fora do ar. */
export const STUCK_WEBHOOK_MINUTES = 15;
/** Rotina parada: sem execução há mais que max(30 min, 3 × intervalo do agendamento). */
export const MIN_STALL_MINUTES = 30;
/** Execução em andamento há mais tempo que a trava da rotina (30 min / 60 min) está travada. */
const LOCK_MINUTES: Record<"SYNC" | "RECONCILE", number> = { SYNC: 30, RECONCILE: 60 };
const FAILED_CHECKPOINT = "alerts.watch.webhooks.failedUntil";

export type WatchFinding =
  | { kind: "webhook-failed"; total: number; items: Array<{ id: string; topic: string | null; lastError: string | null }> }
  | { kind: "webhook-stuck"; count: number; minutes: number }
  | { kind: "job-stalled"; job: "SYNC" | "RECONCILE"; lastStartedAt: Date; running: boolean; minutesSince: number; thresholdMinutes: number };

export interface WatchNotifier {
  notifyFindings(findings: WatchFinding[]): Promise<void>;
}

/** Intervalo do agendamento em minutos (distância entre as duas próximas execuções). */
export function cronIntervalMinutes(expression: string, timeZone: string): number | null {
  try {
    const [a, b] = new Cron(expression, { timezone: timeZone, paused: true }).nextRuns(2);
    return a && b ? Math.round((b.getTime() - a.getTime()) / 60_000) : null;
  } catch {
    return null;
  }
}

/**
 * Vigia que roda a cada 5 minutos no agendador e procura o que nenhuma execução avisaria sozinha:
 * webhooks do Omie que esgotaram as tentativas, webhooks parados na fila e rotina que deixou de rodar.
 * Só encontra; quem decide se e quando avisar (configuração e intervalo mínimo) é o serviço de alertas.
 */
export class HealthWatchdog {
  constructor(
    private readonly deps: {
      webhooks: Pick<WebhookEventRepository, "failedSince" | "countUnfinishedBefore">;
      runs: Pick<SyncRunRepository, "latest">;
      settings: SettingsRepository;
      checkpoints: CheckpointRepository;
      notifier: WatchNotifier;
      clock: Clock;
      timeZone: string;
    },
  ) {}

  async execute(): Promise<WatchFinding[]> {
    const { webhooks, runs, settings: settingsRepo, checkpoints, notifier, clock, timeZone } = this.deps;
    const settings = await settingsRepo.get();
    const now = clock.now();
    const findings: WatchFinding[] = [];

    // Falhas definitivas desde a última verificação (cada uma é avisada uma vez só).
    const last = await checkpoints.get<{ at: string }>(FAILED_CHECKPOINT);
    const since = last ? new Date(last.at) : new Date(now.getTime() - 10 * 60_000);
    const failed = await webhooks.failedSince(since, 10);
    await checkpoints.set(FAILED_CHECKPOINT, { at: now.toISOString() });
    if (failed.total > 0) findings.push({ kind: "webhook-failed", total: failed.total, items: failed.items });

    const stuck = await webhooks.countUnfinishedBefore(new Date(now.getTime() - STUCK_WEBHOOK_MINUTES * 60_000));
    if (stuck > 0) findings.push({ kind: "webhook-stuck", count: stuck, minutes: STUCK_WEBHOOK_MINUTES });

    const jobs: Array<{ job: "SYNC" | "RECONCILE"; enabled: boolean; cron: string }> = [
      { job: "SYNC", enabled: settings.sync.enabled, cron: settings.sync.cron },
      { job: "RECONCILE", enabled: settings.reconcile.enabled, cron: settings.reconcile.cron },
    ];
    for (const { job, enabled, cron } of jobs) {
      if (!enabled) continue;
      const interval = cronIntervalMinutes(cron, timeZone);
      if (interval === null) continue;
      const latest = await runs.latest(job as SyncJob);
      // Instalação nova (nenhuma execução ainda): nada a comparar.
      if (!latest) continue;
      const running = latest.status === "RUNNING";
      const threshold = Math.max(MIN_STALL_MINUTES, interval * 3, running ? LOCK_MINUTES[job] : 0);
      const minutesSince = Math.floor((now.getTime() - latest.startedAt.getTime()) / 60_000);
      if (minutesSince > threshold) findings.push({ kind: "job-stalled", job, lastStartedAt: latest.startedAt, running, minutesSince, thresholdMinutes: threshold });
    }

    if (findings.length) await notifier.notifyFindings(findings);
    return findings;
  }
}
