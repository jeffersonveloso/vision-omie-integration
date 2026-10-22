import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type IntegrationSettings } from "@/server/modules/settings/domain/integration-settings";
import { IntegrationScheduler, MAINTENANCE_CRON } from "./integration-scheduler";

function setup(initial: IntegrationSettings = DEFAULT_SETTINGS) {
  let settings = initial;
  const deps = {
    settings: { get: async () => settings, save: async () => {} },
    sync: { execute: vi.fn(async () => ({})) },
    reconcile: { execute: vi.fn(async () => ({})) },
    maintenance: { execute: vi.fn(async () => null) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    timeZone: "America/Sao_Paulo",
  };
  const scheduler = new IntegrationScheduler(deps as never);
  return { scheduler, deps, change: (next: IntegrationSettings) => (settings = next) };
}

const job = (s: IntegrationScheduler, name: string) => s.status().jobs.find((j) => j.name === name)!;

describe("agendador", () => {
  it("registra coleta, retorno e limpeza diária com próxima execução", async () => {
    const { scheduler } = setup();
    await scheduler.start();
    expect(scheduler.status().running).toBe(true);
    expect(scheduler.status().jobs.map((j) => j.name)).toEqual(["sync", "reconcile", "maintenance"]);
    expect(job(scheduler, "maintenance").cron).toBe(MAINTENANCE_CRON);
    expect(job(scheduler, "sync").nextRunAt).not.toBeNull();
    scheduler.stop();
    expect(scheduler.status()).toEqual({ running: false, jobs: [] });
  });

  it("recarrega quando a configuração muda e desliga rotinas desativadas", async () => {
    const { scheduler, change } = setup();
    await scheduler.start();
    change({ ...DEFAULT_SETTINGS, sync: { ...DEFAULT_SETTINGS.sync, enabled: false }, reconcile: { ...DEFAULT_SETTINGS.reconcile, cron: "*/15 * * * *" } });
    await scheduler.reload();
    expect(job(scheduler, "sync")).toMatchObject({ enabled: false, nextRunAt: null });
    expect(job(scheduler, "reconcile").cron).toBe("*/15 * * * *");
    scheduler.stop();
  });

  it("expressão inválida desliga só aquela rotina e registra o erro", async () => {
    const { scheduler, deps } = setup({ ...DEFAULT_SETTINGS, sync: { ...DEFAULT_SETTINGS.sync, cron: "a cada 5 minutos" } });
    await scheduler.start();
    expect(job(scheduler, "sync").enabled).toBe(false);
    expect(job(scheduler, "reconcile").enabled).toBe(true);
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('"sync"'), expect.anything());
    scheduler.stop();
  });

  it("executa a rotina e registra o horário da última execução", async () => {
    const { scheduler, deps } = setup();
    await scheduler.start();
    const cron = (scheduler as unknown as { jobs: Map<string, { cron: { trigger(): Promise<void> } }> }).jobs.get("sync")!.cron;
    await cron.trigger();
    expect(deps.sync.execute).toHaveBeenCalledWith({ trigger: "SCHEDULE" });
    expect(job(scheduler, "sync").lastRunAt).not.toBeNull();
    scheduler.stop();
  });
});
