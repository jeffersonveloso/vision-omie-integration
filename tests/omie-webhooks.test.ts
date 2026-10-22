/**
 * Webhooks do Omie de ponta a ponta: recebimento → fila → worker → consulta ao Omie → retorno ao Vision.
 * Roda com a fila em memória e, com TEST_REDIS_URL, também com BullMQ num Redis de verdade.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { COMPANIES } from "../scripts/simulators/fixtures";
import { type OmieSimulator, startOmieSimulator } from "../scripts/simulators/omie-simulator";
import { startVisionSimulator, type VisionSimulator } from "../scripts/simulators/vision-simulator";
import { type AppContainer, buildContainer } from "@/server/container";
import { OmieGatewayFactoryImpl } from "@/server/infrastructure/omie/omie-gateway";
import { OmieRateLimiter } from "@/server/infrastructure/omie/omie-rate-limiter";
import { BullMqWebhookQueue } from "@/server/infrastructure/queue/bullmq-webhook-queue";
import { InMemoryWebhookQueue } from "@/server/infrastructure/queue/in-memory-webhook-queue";
import { VisionApiClient } from "@/server/infrastructure/vision/vision-api-client";
import type { WebhookQueue } from "@/server/modules/integration/application/ports";
import { ProcessOmieWebhookEvent, ReceiveOmieWebhook, SweepWebhookEvents } from "@/server/modules/integration/application/use-cases/omie-webhooks";
import { createTestDatabase } from "./support/test-database";

const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const until = async (check: () => Promise<boolean>, timeoutMs = 15_000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("tempo esgotado");
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** Integração pronta: contas, regras, de-para e uma coleta com os pedidos enviados ao Omie. */
async function setup(queue?: WebhookQueue) {
  const vision = await startVisionSimulator(0);
  const omie = await startOmieSimulator(0);
  const database = await createTestDatabase();
  const app = await buildContainer({
    databaseUrl: database.url,
    vision: new VisionApiClient({ baseUrl: vision.url, username: "OMIE", password: "simulador", timeoutMs: 5000, timeZone: "America/Sao_Paulo" }),
    omie: new OmieGatewayFactoryImpl({ baseUrl: omie.url, timeoutMs: 5000, maxInlineRetries: 0, readCacheTtlMs: 0 }, new OmieRateLimiter({ readConcurrency: 2, minIntervalMs: 0 })),
    webhookQueue: queue,
  });
  const ids: Record<string, string> = {};
  for (const [key, c] of Object.entries({ matriz: COMPANIES.matriz, filial: COMPANIES.filial })) {
    ids[key] = (await app.omieAccounts.create({ name: c.name, cnpj: c.cnpj, appKey: c.appKey, appSecret: c.appSecret, active: true })).id;
  }
  for (const [doc, field, value] of [
    ["SALES_ORDER", "informacoes_adicionais.codigo_categoria", "1.01.01"],
    ["SALES_ORDER", "informacoes_adicionais.codigo_conta_corrente", "11850365"],
    ["SERVICE_ORDER", "InformacoesAdicionais.cCodCateg", "1.01.02"],
    ["SERVICE_ORDER", "InformacoesAdicionais.nCodCC", "11850365"],
  ] as const) {
    await app.mappingAdmin.saveRule({ omieAccountId: null, documentType: doc, targetField: field, sourceType: "CONSTANT", constantValue: value, transforms: [], active: true, notes: null });
  }
  const maps = await app.mappingAdmin.listMaps();
  const map = (k: string) => maps.find((m) => m.key === k)!.id;
  await app.mappingAdmin.upsertEntry({ valueMapId: map("empresa-cnpj"), omieAccountId: ids.matriz, visionValue: "1", omieValue: COMPANIES.matriz.cnpj });
  await app.mappingAdmin.upsertEntry({ valueMapId: map("empresa-cnpj"), omieAccountId: ids.filial, visionValue: "2", omieValue: COMPANIES.filial.cnpj });
  for (const id of Object.values(ids)) {
    await app.mappingAdmin.importEntries(map("produtos"), id, "123;4422421\n456;4422456");
    await app.mappingAdmin.importEntries(map("servicos"), id, "77;8800077\n78;8800078");
  }
  await app.useCases.syncJob.execute({ trigger: "MANUAL" });
  const order = (await app.queries.list({ search: "14100", page: 1, pageSize: 5 })).items.find((i) => i.visionOrderCode === 14100)!;
  const omieId = (await app.queries.detail(order.id))!.documentsFull.find((d) => d.kind === "SALES_ORDER")!.omieId!;
  const close = async () => {
    await app.webhookQueue.close();
    await vision.close();
    await omie.close();
    await app.database.close();
    await database.drop();
  };
  return { app, vision, omie, order, omieId, close };
}

const faturada = (omieId: number, appKey = COMPANIES.matriz.appKey) => ({ messageId: randomUUID(), topic: "VendaProduto.Faturada", appKey, author: { name: "Omie" }, event: { idPedido: omieId, etapa: "60" } });

describe("webhooks do Omie com a fila em memória", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  const idle = () => (ctx.app.webhookQueue as InMemoryWebhookQueue).idle();
  const event = async (id: string) => (await ctx.app.webhookEvents.findById(id))!;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(async () => ctx?.close());

  it("grava, enfileira e responde na hora; o worker consulta o Omie e devolve a nota ao Vision", async () => {
    const first = await ctx.app.useCases.receiveWebhook.execute(faturada(ctx.omieId));
    expect(first).toMatchObject({ duplicate: false, queued: true });
    await idle();
    expect(await event(first.eventId)).toMatchObject({ status: "DONE", relatedOrderId: ctx.order.id, attempts: 1, note: "Consulta feita; nada novo para devolver ao Vision." });

    // O simulador fatura na segunda consulta: o segundo evento já devolve a autorização ao Vision.
    const second = await ctx.app.useCases.receiveWebhook.execute(faturada(ctx.omieId));
    await idle();
    expect((await event(second.eventId)).note).toMatch(/evento\(s\) devolvido\(s\) ao Vision/);
    expect(ctx.vision.returns.some((r) => r.endpoint === "/api/pedido/nota/autorizacao" && r.body.codigoPedido === 14100)).toBe(true);
    const timeline = await ctx.app.queries.logs({ orderId: ctx.order.id });
    expect(timeline.some((l) => l.message === "Webhook do Omie (VendaProduto.Faturada) recebido; consultando o Omie agora.")).toBe(true);
  });

  it("o mesmo messageId reenviado pelo Omie não é processado duas vezes", async () => {
    const payload = faturada(ctx.omieId);
    const a = await ctx.app.useCases.receiveWebhook.execute(payload);
    const b = await ctx.app.useCases.receiveWebhook.execute(payload);
    expect(b).toEqual({ eventId: a.eventId, duplicate: true, queued: false });
    await idle();
  });

  it("App Key de outra empresa e evento sem pedido da integração ficam registrados como sem pedido relacionado", async () => {
    const stranger = await ctx.app.useCases.receiveWebhook.execute(faturada(ctx.omieId, "APP-DE-OUTRA-EMPRESA"));
    const unrelated = await ctx.app.useCases.receiveWebhook.execute(faturada(999_999));
    await idle();
    expect(await event(stranger.eventId)).toMatchObject({ status: "IGNORED", note: "A App Key do evento não pertence a nenhuma conta Omie cadastrada." });
    expect(await event(unrelated.eventId)).toMatchObject({ status: "IGNORED", note: "Nenhum pedido da integração relacionado a este evento." });
  });

  it("falha no processamento: tenta de novo, marca FAILED no fim e o reprocessamento manual resolve", async () => {
    const flaky = new InMemoryWebhookQueue({ attempts: 2, backoffMs: 1, logger });
    const broken = new ProcessOmieWebhookEvent({
      events: ctx.app.webhookEvents,
      orders: { findByOmieDocumentId: async () => { throw new Error("banco instável"); } } as never,
      accounts: { list: async () => [] } as never,
      reconcile: {} as never,
      logs: { append: async () => {}, purge: async () => 0 },
      clock: { now: () => new Date() },
    });
    await flaky.startWorker((id, c) => broken.execute(id, c));
    const receive = new ReceiveOmieWebhook({ events: ctx.app.webhookEvents, queue: flaky, ids: { next: () => randomUUID() }, clock: { now: () => new Date() }, logger });
    const { eventId } = await receive.execute({ ...faturada(ctx.omieId), appKey: undefined });
    await flaky.idle();
    expect(await event(eventId)).toMatchObject({ status: "FAILED", attempts: 2, lastError: "banco instável" });

    const retried = await ctx.app.useCases.retryWebhooks.execute({});
    expect(retried.queued).toBe(1);
    await idle();
    expect(await event(eventId)).toMatchObject({ status: "DONE", lastError: null, attempts: 3 });
  });

  it("fila fora do ar no recebimento: o evento fica gravado e a varredura enfileira depois", async () => {
    const down: WebhookQueue = { mode: "redis", enqueue: async () => { throw new Error("Redis indisponível"); }, startWorker: async () => {}, counts: async () => null, close: async () => {} };
    const receive = new ReceiveOmieWebhook({ events: ctx.app.webhookEvents, queue: down, ids: { next: () => randomUUID() }, clock: { now: () => new Date() }, logger });
    const { eventId, queued } = await receive.execute(faturada(ctx.omieId));
    expect(queued).toBe(false);
    expect((await event(eventId)).status).toBe("RECEIVED");

    const later = new SweepWebhookEvents({ events: ctx.app.webhookEvents, queue: ctx.app.webhookQueue, clock: { now: () => new Date(Date.now() + 5 * 60_000) }, logger });
    expect(await later.execute()).toBe(1);
    await idle();
    expect((await event(eventId)).status).toBe("DONE");

    const list = await ctx.app.webhookEvents.list({ page: 1, pageSize: 50 });
    expect(list.items.find((i) => i.id === eventId)).toMatchObject({ visionOrderCode: 14100 });
    expect(list.counts.DONE).toBeGreaterThanOrEqual(4);
  });

  it("retenção nunca apaga evento pendente", async () => {
    const down: WebhookQueue = { mode: "redis", enqueue: async () => { throw new Error("Redis indisponível"); }, startWorker: async () => {}, counts: async () => null, close: async () => {} };
    const receive = new ReceiveOmieWebhook({ events: ctx.app.webhookEvents, queue: down, ids: { next: () => randomUUID() }, clock: { now: () => new Date() }, logger });
    const { eventId } = await receive.execute(faturada(ctx.omieId));
    const removed = await ctx.app.webhookEvents.purgeBefore(new Date(Date.now() + 60_000));
    expect(removed).toBeGreaterThan(0);
    const left = await ctx.app.webhookEvents.list({ page: 1, pageSize: 50 });
    expect(left.items.map((i) => [i.id, i.status])).toEqual([[eventId, "RECEIVED"]]);
  });
});

describe.skipIf(!process.env.TEST_REDIS_URL)("webhooks do Omie com BullMQ no Redis", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup(new BullMqWebhookQueue(process.env.TEST_REDIS_URL!, { prefix: `teste-${randomUUID().slice(0, 8)}`, attempts: 3, backoffMs: 50, concurrency: 2, logger }));
    await ctx.app.startWebhookWorker();
  });
  afterAll(async () => ctx?.close());

  it("o worker do BullMQ processa o evento e o pedido é consultado no Omie", async () => {
    const { eventId, queued } = await ctx.app.useCases.receiveWebhook.execute(faturada(ctx.omieId));
    expect(queued).toBe(true);
    await until(async () => (await ctx.app.webhookEvents.findById(eventId))?.status === "DONE");
    expect((await ctx.app.webhookEvents.findById(eventId))!.relatedOrderId).toBe(ctx.order.id);
    expect(await ctx.app.webhookQueue.counts()).toMatchObject({ completed: 1, failed: 0 });
  });
});
