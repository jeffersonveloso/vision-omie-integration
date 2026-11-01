import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/server/modules/settings/domain/integration-settings";
import type { SyncRun } from "@/server/modules/integration/domain/repositories";
import { cronIntervalMinutes, HealthWatchdog, type WatchFinding } from "./health-watchdog";

const NOW = new Date("2026-10-31T15:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const run = (job: "SYNC" | "RECONCILE", startedMinutesAgo: number, status: SyncRun["status"] = "SUCCESS"): SyncRun => ({ id: job, job, trigger: "SCHEDULE", status, startedAt: minutesAgo(startedMinutesAgo), finishedAt: null, windowFrom: null, windowTo: null, stats: {}, error: null });

function setup(opts: { failed?: number; stuck?: number; latest?: Partial<Record<"SYNC" | "RECONCILE", SyncRun | null>>; settings?: typeof DEFAULT_SETTINGS } = {}) {
  const store = new Map<string, unknown>();
  const notified: WatchFinding[][] = [];
  const failedSince = vi.fn(async () => ({ total: opts.failed ?? 0, items: Array.from({ length: Math.min(opts.failed ?? 0, 10) }, (_, i) => ({ id: String(i), topic: "OrdemServico.Faturada", lastError: "erro", failedAt: NOW })) }));
  const watchdog = new HealthWatchdog({
    webhooks: { failedSince, countUnfinishedBefore: vi.fn(async () => opts.stuck ?? 0) },
    runs: { latest: vi.fn(async (job) => opts.latest?.[job as "SYNC" | "RECONCILE"] ?? null) },
    settings: { get: async () => opts.settings ?? DEFAULT_SETTINGS, save: async () => {} },
    checkpoints: { get: async (k: string) => (store.get(k) as never) ?? null, set: async (k: string, v: unknown) => void store.set(k, v), delete: async () => {} },
    notifier: { notifyFindings: async (f) => void notified.push(f) },
    clock: { now: () => NOW },
    timeZone: "America/Sao_Paulo",
  });
  return { watchdog, notified, failedSince, store };
}

describe("vigia", () => {
  it("intervalo do agendamento a partir do cron", () => {
    expect(cronIntervalMinutes("*/5 * * * *", "America/Sao_Paulo")).toBe(5);
    expect(cronIntervalMinutes("0 */2 * * *", "America/Sao_Paulo")).toBe(120);
    expect(cronIntervalMinutes("não é cron", "America/Sao_Paulo")).toBeNull();
  });

  it("tudo em dia: não avisa nada e guarda até onde olhou as falhas", async () => {
    const { watchdog, notified, failedSince, store } = setup({ latest: { SYNC: run("SYNC", 4), RECONCILE: run("RECONCILE", 9) } });
    expect(await watchdog.execute()).toEqual([]);
    expect(notified).toEqual([]);
    expect(failedSince).toHaveBeenCalledWith(minutesAgo(10), 10);
    expect(store.get("alerts.watch.webhooks.failedUntil")).toEqual({ at: NOW.toISOString() });
    await watchdog.execute();
    expect(failedSince).toHaveBeenLastCalledWith(NOW, 10);
  });

  it("acha webhooks com falha, parados na fila e rotinas paradas ou travadas", async () => {
    const { watchdog, notified } = setup({ failed: 2, stuck: 4, latest: { SYNC: run("SYNC", 45), RECONCILE: run("RECONCILE", 70, "RUNNING") } });
    const findings = await watchdog.execute();
    expect(findings.map((f) => f.kind)).toEqual(["webhook-failed", "webhook-stuck", "job-stalled", "job-stalled"]);
    expect(findings[2]).toMatchObject({ job: "SYNC", running: false, minutesSince: 45, thresholdMinutes: 30 });
    expect(findings[3]).toMatchObject({ job: "RECONCILE", running: true, thresholdMinutes: 60 });
    expect(notified).toHaveLength(1);
  });

  it("execução em andamento dentro do prazo da trava, rotina desligada ou instalação nova não contam", async () => {
    const disabled = { ...DEFAULT_SETTINGS, reconcile: { ...DEFAULT_SETTINGS.reconcile, enabled: false } };
    const { watchdog } = setup({ settings: disabled, latest: { SYNC: run("SYNC", 25, "RUNNING"), RECONCILE: run("RECONCILE", 500) } });
    expect(await watchdog.execute()).toEqual([]);
    expect(await setup().watchdog.execute()).toEqual([]);
  });
});
