import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type IntegrationSettings } from "@/server/modules/settings/domain/integration-settings";
import type { RunNotice } from "@/server/modules/integration/application/ports";
import type { AlertChannel, AlertMessage } from "./alert-channel";
import { AlertService } from "./alert-service";

class MemoryChannel implements AlertChannel {
  readonly name = "memória";
  sent: AlertMessage[] = [];
  fail = false;
  constructor(public configured = true) {}
  link(url: string, text: string) {
    return `<${url}|${text}>`;
  }
  escape(text: string) {
    return text;
  }
  async send(message: AlertMessage) {
    if (this.fail) throw new Error("fora do ar");
    this.sent.push(message);
  }
}

function setup(alerts: Partial<IntegrationSettings["alerts"]> = {}, opts: { configured?: boolean; baseUrl?: string | null } = {}) {
  const channel = new MemoryChannel(opts.configured ?? true);
  const store = new Map<string, unknown>();
  let now = new Date("2026-10-22T12:00:00Z");
  const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new AlertService({
    channel,
    settings: { get: async () => ({ ...DEFAULT_SETTINGS, alerts: { ...DEFAULT_SETTINGS.alerts, enabled: true, ...alerts } }), save: async () => {} },
    checkpoints: { get: async (k: string) => (store.get(k) as never) ?? null, set: async (k: string, v: unknown) => void store.set(k, v), delete: async (k: string) => void store.delete(k) },
    clock: { now: () => now },
    logger,
    timeZone: "America/Sao_Paulo",
    appBaseUrl: opts.baseUrl === undefined ? "https://integracao.test" : opts.baseUrl,
  });
  return { channel, service, logger, advance: (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000)) };
}

const run = (over: Partial<RunNotice["run"]> = {}): RunNotice["run"] => ({ id: "9f1c2d3e-0000-4000-8000-000000000000", job: "SYNC", trigger: "SCHEDULE", status: "PARTIAL", startedAt: new Date(), finishedAt: new Date(), windowFrom: null, windowTo: null, stats: {}, error: null, ...over });

describe("alertas", () => {
  it("agrupa os pedidos que entraram em erro numa mensagem, com link para cada um", async () => {
    const { channel, service } = setup();
    await service.notifyRun({
      run: run(),
      failures: [
        { orderId: "a", visionOrderCode: 14103, category: "MAPPING", message: 'sem de-para para o valor "999"' },
        { orderId: "b", visionOrderCode: 14104, category: "ROUTING", message: "empresa 3 sem conta" },
        { orderId: "c", visionOrderCode: 14108, category: "MAPPING", message: "categoria não mapeada" },
      ],
      rejections: [],
    });
    expect(channel.sent).toHaveLength(1);
    const [message] = channel.sent;
    expect(message.title).toBe("3 pedidos entraram em erro");
    expect(message.lines[0]).toBe("Mapeamento de dados: 2 · Roteamento para a conta Omie: 1");
    expect(message.lines[1]).toContain("<https://integracao.test/pedidos/a|Pedido 14103>");
    expect(message.action?.url).toBe("https://integracao.test/pedidos?status=ERROR");
  });

  it("avisa rotina com falha uma vez por intervalo", async () => {
    const { channel, service, advance } = setup({ cooldownMinutes: 60 });
    const failed = { run: run({ status: "FAILED", error: "Coleta no Vision falhou: timeout" }), failures: [], rejections: [] };
    await service.notifyRun(failed);
    advance(30);
    await service.notifyRun(failed);
    expect(channel.sent.map((m) => m.title)).toEqual(["Coleta e envio (Vision → Omie) com falha"]);
    advance(31);
    await service.notifyRun(failed);
    expect(channel.sent).toHaveLength(2);
  });

  it("avisa nota rejeitada e respeita cada opção desligada", async () => {
    const { channel, service } = setup({ onRejection: true, onOrderErrors: false });
    await service.notifyRun({ run: run({ job: "RECONCILE" }), failures: [{ orderId: "a", visionOrderCode: 1, category: "MAPPING", message: "x" }], rejections: [{ orderId: "r", visionOrderCode: 14105, message: "539 — Duplicidade de NF-e" }] });
    expect(channel.sent.map((m) => m.title)).toEqual(["Nota do pedido 14105 rejeitada"]);
  });

  it("não envia nada desligado ou sem webhook, e falha do canal não derruba a rotina", async () => {
    const off = setup({ enabled: false });
    await off.service.notifyRun({ run: run({ error: "x" }), failures: [], rejections: [] });
    expect(off.channel.sent).toHaveLength(0);
    const unconfigured = setup({}, { configured: false });
    await unconfigured.service.notifyRun({ run: run({ error: "x" }), failures: [], rejections: [] });
    expect(unconfigured.channel.sent).toHaveLength(0);
    const broken = setup();
    broken.channel.fail = true;
    await expect(broken.service.notifyRun({ run: run({ error: "x" }), failures: [], rejections: [] })).resolves.toBeUndefined();
    expect(broken.logger.error).toHaveBeenCalled();
  });

  it("sem APP_BASE_URL a mensagem sai sem links", async () => {
    const { channel, service } = setup({}, { baseUrl: null });
    await service.notifyRun({ run: run(), failures: [{ orderId: "a", visionOrderCode: 14103, category: "MAPPING", message: "x" }], rejections: [] });
    expect(channel.sent[0].lines[1]).toContain("*Pedido 14103*");
    expect(channel.sent[0].action).toBeUndefined();
  });

  it("vigia: webhooks com falha sempre; fila parada e rotina parada respeitam o intervalo e as chaves", async () => {
    const { channel, service, advance } = setup({ cooldownMinutes: 60 });
    const findings = [
      { kind: "webhook-failed" as const, total: 12, items: [{ id: "1", topic: "VendaProduto.Faturada", lastError: "Omie fora do ar" }] },
      { kind: "webhook-stuck" as const, count: 3, minutes: 15 },
      { kind: "job-stalled" as const, job: "SYNC" as const, lastStartedAt: new Date("2026-10-22T10:00:00Z"), running: false, minutesSince: 120, thresholdMinutes: 30 },
      { kind: "job-stalled" as const, job: "RECONCILE" as const, lastStartedAt: new Date("2026-10-22T10:30:00Z"), running: true, minutesSince: 90, thresholdMinutes: 60 },
    ];
    await service.notifyFindings(findings);
    expect(channel.sent.map((m) => m.title)).toEqual([
      "12 webhooks do Omie esgotaram as tentativas",
      "3 webhook(s) do Omie parado(s) na fila",
      "Coleta e envio (Vision → Omie) parada",
      "Retorno ao Vision (Omie → Vision) parada",
    ]);
    expect(channel.sent[0].lines).toContain("… e mais 11 evento(s).");
    expect(channel.sent[2].lines[0]).toContain("já deveria ter rodado de novo");
    expect(channel.sent[3].lines[0]).toContain("continua em andamento há 90 minutos");

    await service.notifyFindings(findings);
    expect(channel.sent).toHaveLength(5); // só a falha nova de webhook; as outras esperam o intervalo
    advance(61);
    await service.notifyFindings(findings);
    expect(channel.sent).toHaveLength(9);
  });

  it("vigia: respeita as chaves da tela e não derruba nada se o canal falhar", async () => {
    const off = setup({ onWebhookProblems: false, onStalledJobs: false });
    await off.service.notifyFindings([{ kind: "webhook-stuck", count: 1, minutes: 15 }, { kind: "job-stalled", job: "SYNC", lastStartedAt: new Date(), running: false, minutesSince: 99, thresholdMinutes: 30 }]);
    expect(off.channel.sent).toHaveLength(0);
    const broken = setup();
    broken.channel.fail = true;
    await broken.service.notifyFindings([{ kind: "webhook-stuck", count: 1, minutes: 15 }]);
    expect(broken.logger.error).toHaveBeenCalledWith("Falha ao enviar alerta do vigia", expect.anything());
  });
});
