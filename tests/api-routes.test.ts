/**
 * Rotas /api ponta a ponta: chama os route handlers do Next com requisições reais (NextRequest),
 * o mesmo container dos testes de fluxo (simuladores HTTP + PGlite em memória) e um canal de alertas em memória.
 * Cobre contrato HTTP (status, erros 404/409/422/500, x-request-id), auditoria com autor, alertas e retenção.
 */
process.env.OMIE_WEBHOOK_TOKEN = "token-webhook-teste";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { COMPANIES } from "../scripts/simulators/fixtures";
import { type OmieSimulator, startOmieSimulator } from "../scripts/simulators/omie-simulator";
import { startVisionSimulator, type VisionSimulator } from "../scripts/simulators/vision-simulator";
import * as auditRoute from "@/app/api/audit/route";
import * as dashboardRoute from "@/app/api/dashboard/route";
import * as healthRoute from "@/app/api/health/route";
import * as catalogRoute from "@/app/api/mappings/catalog/route";
import * as ruleRoute from "@/app/api/mappings/rules/[id]/route";
import * as rulesRoute from "@/app/api/mappings/rules/route";
import * as entryRoute from "@/app/api/mappings/value-maps/[id]/entries/[entryId]/route";
import * as entriesRoute from "@/app/api/mappings/value-maps/[id]/entries/route";
import * as importRoute from "@/app/api/mappings/value-maps/[id]/import/route";
import * as mapRoute from "@/app/api/mappings/value-maps/[id]/route";
import * as mapsRoute from "@/app/api/mappings/value-maps/route";
import * as lookupRoute from "@/app/api/omie-accounts/[id]/lookups/[entity]/route";
import * as accountRoute from "@/app/api/omie-accounts/[id]/route";
import * as accountTestRoute from "@/app/api/omie-accounts/[id]/test/route";
import * as accountsRoute from "@/app/api/omie-accounts/route";
import * as ackRoute from "@/app/api/orders/[id]/acknowledge/route";
import * as ignoreRoute from "@/app/api/orders/[id]/ignore/route";
import * as previewRoute from "@/app/api/orders/[id]/preview/route";
import * as orderRetryRoute from "@/app/api/orders/[id]/retry/route";
import * as orderRoute from "@/app/api/orders/[id]/route";
import * as bulkRetryRoute from "@/app/api/orders/retry/route";
import * as ordersRoute from "@/app/api/orders/route";
import * as paymentFormsRoute from "@/app/api/settings/payment-forms/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as testAlertRoute from "@/app/api/settings/test-alert/route";
import * as testVisionRoute from "@/app/api/settings/test-vision/route";
import * as collectionRoute from "@/app/api/sync/collection/route";
import * as runRoute from "@/app/api/sync/run/route";
import * as runLogsRoute from "@/app/api/sync/runs/[id]/route";
import * as runsRoute from "@/app/api/sync/runs/route";
import * as webhookEventsRoute from "@/app/api/webhooks/events/route";
import * as webhookRetryRoute from "@/app/api/webhooks/events/retry/route";
import * as webhookRoute from "@/app/api/webhooks/omie/route";
import { type AppContainer, buildContainer } from "@/server/container";
import { createTestDatabase } from "./support/test-database";
import { integrationLogs } from "@/server/infrastructure/database/schema";
import { OmieGatewayFactoryImpl } from "@/server/infrastructure/omie/omie-gateway";
import { OmieRateLimiter } from "@/server/infrastructure/omie/omie-rate-limiter";
import { VisionApiClient } from "@/server/infrastructure/vision/vision-api-client";
import type { AlertChannel, AlertMessage } from "@/server/modules/alerts/application/alert-channel";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RouteModule = object;
type RouteFn = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ANA = { "x-forwarded-email": "ana@ecolife.com.br", "x-forwarded-for": "10.0.0.7, 172.16.0.1" };

class MemoryChannel implements AlertChannel {
  readonly name = "memória";
  readonly configured = true;
  sent: AlertMessage[] = [];
  link = (url: string, text: string) => `<${url}|${text}>`;
  escape = (t: string) => t;
  async send(m: AlertMessage) {
    this.sent.push(m);
  }
}

describe("API HTTP", () => {
  let vision: VisionSimulator;
  let omie: OmieSimulator;
  let app: AppContainer;
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  const alerts = new MemoryChannel();
  const ids: Record<string, string> = {};

  async function call(mod: RouteModule, method: Method, path: string, opts: { body?: unknown; headers?: Record<string, string>; params?: Record<string, string> } = {}) {
    const request = new NextRequest(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const response = await (mod as Record<string, RouteFn>)[method](request, { params: Promise.resolve(opts.params ?? {}) });
    return { status: response.status, headers: response.headers, body: (await response.json()) as Json };
  }
  const audit = async (query = "") => (await call(auditRoute, "GET", `/api/audit${query}`)).body.items as Json[];

  beforeAll(async () => {
    vision = await startVisionSimulator(0);
    omie = await startOmieSimulator(0);
    omie.rejectIntegrationCodes.add("VIS-14105");
    app = await buildContainer({
      databaseUrl: (database = await createTestDatabase()).url,
      vision: new VisionApiClient({ baseUrl: vision.url, username: "OMIE", password: "simulador", timeoutMs: 5000, timeZone: "America/Sao_Paulo" }),
      omie: new OmieGatewayFactoryImpl({ baseUrl: omie.url, timeoutMs: 5000, maxInlineRetries: 0, readCacheTtlMs: 0 }, new OmieRateLimiter({ readConcurrency: 2, minIntervalMs: 0 })),
      alertChannel: alerts,
      appBaseUrl: "https://integracao.test",
    });
    (globalThis as unknown as { __visionOmieContainer?: Promise<AppContainer> }).__visionOmieContainer = Promise.resolve(app);
  });

  afterAll(async () => {
    await vision?.close();
    await omie?.close();
    await app?.database.close();
    await database?.drop();
  });

  it("health devolve x-request-id (gera um novo ou reaproveita o recebido)", async () => {
    const generated = await call(healthRoute, "GET", "/api/health");
    expect(generated.status).toBe(200);
    expect(generated.body).toMatchObject({ ok: true, database: process.env.TEST_DATABASE_URL ? "postgres" : "pglite" });
    expect(generated.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect((await call(healthRoute, "GET", "/api/health", { headers: { "x-request-id": "req-123.abc" } })).headers.get("x-request-id")).toBe("req-123.abc");
    expect((await call(healthRoute, "GET", "/api/health", { headers: { "x-request-id": "não vale" } })).headers.get("x-request-id")).not.toBe("não vale");
  });

  it("contas Omie: validação 422, conflito 409, 404, segredo nunca exposto e auditoria com autor", async () => {
    const invalid = await call(accountsRoute, "POST", "/api/omie-accounts", { body: { name: "" } });
    expect(invalid.status).toBe(422);
    expect(Object.keys(invalid.body.error.fieldErrors)).toEqual(expect.arrayContaining(["cnpj", "appKey"]));

    for (const [key, c] of Object.entries({ matriz: COMPANIES.matriz, filial: COMPANIES.filial })) {
      const created = await call(accountsRoute, "POST", "/api/omie-accounts", { headers: ANA, body: { name: c.name, cnpj: c.cnpj, appKey: c.appKey, appSecret: c.appSecret, description: key, active: true } });
      expect(created.status).toBe(201);
      expect(JSON.stringify(created.body)).not.toContain(c.appSecret);
      ids[key] = created.body.account.id;
    }
    const duplicate = await call(accountsRoute, "POST", "/api/omie-accounts", { body: { name: "Outra", cnpj: COMPANIES.matriz.cnpj, appKey: "k", appSecret: "s", active: true } });
    expect(duplicate.status).toBe(409);
    expect((await call(accountRoute, "GET", "/api/omie-accounts/x", { params: { id: "00000000-0000-4000-8000-000000000000" } })).status).toBe(404);

    const updated = await call(accountRoute, "PUT", `/api/omie-accounts/${ids.matriz}`, {
      headers: ANA,
      params: { id: ids.matriz },
      body: { name: COMPANIES.matriz.name, cnpj: COMPANIES.matriz.cnpj, appKey: COMPANIES.matriz.appKey, appSecret: "segredo-novo-123", description: "Base principal", active: true },
    });
    expect(updated.status).toBe(200);
    // Volta o segredo original para o simulador aceitar as próximas chamadas.
    await call(accountRoute, "PUT", `/api/omie-accounts/${ids.matriz}`, { params: { id: ids.matriz }, body: { name: COMPANIES.matriz.name, cnpj: COMPANIES.matriz.cnpj, appKey: COMPANIES.matriz.appKey, appSecret: COMPANIES.matriz.appSecret, description: "Base principal", active: true } });
    expect((await call(accountRoute, "PATCH", "/x", { params: { id: ids.filial }, body: { active: false } })).body.account.active).toBe(false);
    await call(accountRoute, "PATCH", "/x", { params: { id: ids.filial }, body: { active: true } });

    const events = await audit("?entityType=OMIE_ACCOUNT");
    const edit = events.find((e) => e.action === "omie-account.update" && e.actor === "ana@ecolife.com.br");
    expect(edit).toMatchObject({ ip: "10.0.0.7", summary: `Conta Omie "${COMPANIES.matriz.name}" alterada.` });
    expect(edit.changes).toEqual(expect.arrayContaining([{ path: "description", before: "matriz", after: "Base principal" }, { path: "appSecret", before: "[oculto]", after: "[alterado]" }]));
    expect(JSON.stringify(events)).not.toContain("segredo-novo-123");
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["omie-account.create", "omie-account.deactivate", "omie-account.activate"]));

    expect((await call(accountTestRoute, "POST", "/x", { params: { id: ids.matriz } })).body.ok).toBe(true);
    const categories = await call(lookupRoute, "GET", "/x", { params: { id: ids.matriz, entity: "categorias" } });
    expect(categories.body.options.map((o: Json) => o.value)).toContain("1.01.02");
  });

  it("mapeamentos: regras, tabelas de-para, importação e exclusões ficam na auditoria", async () => {
    expect((await call(catalogRoute, "GET", "/api/mappings/catalog")).body.documentTypes).toBeTruthy();
    for (const [documentType, targetField, constantValue] of [
      ["SALES_ORDER", "informacoes_adicionais.codigo_categoria", "1.01.01"],
      ["SALES_ORDER", "informacoes_adicionais.codigo_conta_corrente", "11850365"],
      ["SERVICE_ORDER", "InformacoesAdicionais.cCodCateg", "1.01.02"],
      ["SERVICE_ORDER", "InformacoesAdicionais.nCodCC", "11850365"],
    ]) {
      const saved = await call(rulesRoute, "PUT", "/api/mappings/rules", { headers: ANA, body: { omieAccountId: null, documentType, targetField, sourceType: "CONSTANT", constantValue, transforms: [] } });
      expect(saved.status).toBe(200);
    }
    const temp = await call(rulesRoute, "PUT", "/api/mappings/rules", { body: { omieAccountId: ids.filial, documentType: "SALES_ORDER", targetField: "observacoes.obs_venda", sourceType: "CONSTANT", constantValue: "x", transforms: [] } });
    expect((await call(ruleRoute, "DELETE", "/x", { params: { id: temp.body.rule.id } })).status).toBe(200);
    const rules = await call(rulesRoute, "GET", `/api/mappings/rules?documentType=SALES_ORDER&accountId=${ids.matriz}`);
    expect(rules.body.rules.find((r: Json) => r.key === "cabecalho.codigo_parcela")).toMatchObject({ managedBy: "Configurações › Condições de pagamento" });

    const maps = (await call(mapsRoute, "GET", "/api/mappings/value-maps")).body.maps as Json[];
    const byKey = (k: string) => maps.find((m) => m.key === k)!.id as string;
    for (const [key, company] of [["matriz", COMPANIES.matriz], ["filial", COMPANIES.filial]] as const) {
      await call(entriesRoute, "POST", "/x", { headers: ANA, params: { id: byKey("empresa-cnpj") }, body: { omieAccountId: ids[key], visionValue: company.code, omieValue: company.cnpj } });
      const imported = await call(importRoute, "POST", "/x", { params: { id: byKey("produtos") }, body: { omieAccountId: ids[key], text: "valor vision;valor omie\n123;4422421\n456;4422456\nsem-valor" } });
      expect(imported.body).toMatchObject({ imported: 2 });
      await call(importRoute, "POST", "/x", { params: { id: byKey("servicos") }, body: { omieAccountId: ids[key], text: "77;8800077\n78;8800078" } });
    }
    const entries = await call(entriesRoute, "GET", `/x?accountId=${ids.matriz}`, { params: { id: byKey("produtos") } });
    expect(entries.body.entries).toHaveLength(2);

    const custom = await call(mapsRoute, "POST", "/api/mappings/value-maps", { headers: ANA, body: { key: "vendedores-vision", name: "Vendedores", omieEntity: "vendedores" } });
    expect(custom.status).toBe(201);
    const customId = custom.body.map.id;
    await call(mapRoute, "PUT", "/x", { params: { id: customId }, body: { name: "Vendedores do Vision", omieEntity: "vendedores", description: "Código do vendedor → vendedor no Omie" } });
    const entry = await call(entriesRoute, "POST", "/x", { params: { id: customId }, body: { omieAccountId: ids.matriz, visionValue: "7", omieValue: "7001" } });
    expect((await call(entryRoute, "DELETE", "/x", { params: { id: customId, entryId: entry.body.entry.id } })).status).toBe(200);
    expect((await call(mapRoute, "DELETE", "/x", { params: { id: byKey("produtos") } })).status).toBe(400);
    expect((await call(mapRoute, "DELETE", "/x", { params: { id: customId } })).status).toBe(200);

    const actions = (await audit("?pageSize=200")).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["field-rule.save", "field-rule.delete", "value-map.import", "value-map.entry.save", "value-map.create", "value-map.update", "value-map.entry.delete", "value-map.delete"]));
    const mapping = (await audit("?entityType=VALUE_MAP&search=ana@")).find((e) => e.action === "value-map.entry.save" && e.summary.includes(COMPANIES.matriz.name));
    expect(mapping.summary).toContain(`: ${COMPANIES.matriz.code} → ${COMPANIES.matriz.cnpj}`);
  });

  it("configurações: 422 com o campo do erro; alterações auditadas campo a campo; teste do Slack", async () => {
    const current = (await call(settingsRoute, "GET", "/api/settings")).body;
    expect(current.environment).toMatchObject({ slackConfigured: true, appBaseUrl: null, initialLookbackDaysEnv: 7 });
    const bad = await call(settingsRoute, "PUT", "/api/settings", { body: { ...current.settings, logs: { retentionDays: 90, errorRetentionDays: 30, auditRetentionDays: 730 } } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fieldErrors["logs.errorRetentionDays"]).toBeTruthy();

    const next = {
      ...current.settings,
      alerts: { ...current.settings.alerts, enabled: true, cooldownMinutes: 60 },
      paymentTerms: { ...current.settings.paymentTerms, byPaymentForm: [{ visionCode: 2, visionDescription: "SEM FINANCEIRO", omieCode: "000", omieDescription: "À vista" }] },
    };
    expect((await call(settingsRoute, "PUT", "/api/settings", { headers: ANA, body: next })).status).toBe(200);
    const [change] = await audit("?entityType=SETTINGS");
    expect(change.actor).toBe("ana@ecolife.com.br");
    expect(change.changes.map((c: Json) => c.path)).toEqual(expect.arrayContaining(["alerts.enabled", "paymentTerms.byPaymentForm"]));

    expect((await call(testVisionRoute, "POST", "/api/settings/test-vision")).body).toMatchObject({ ok: true });
    expect((await call(testAlertRoute, "POST", "/api/settings/test-alert", { headers: ANA })).body.ok).toBe(true);
    expect(alerts.sent.at(-1)!.title).toBe("Teste de alerta da integração Vision ⇄ Omie");
    expect(alerts.sent.at(-1)!.lines[0]).toContain("ana@ecolife.com.br");
  });

  it("sincronizar agora: execução auditada e um alerta por execução com os pedidos que entraram em erro", async () => {
    const before = alerts.sent.length;
    const run = await call(runRoute, "POST", "/api/sync/run", { headers: ANA, body: { job: "SYNC" } });
    expect(run.body.run).toMatchObject({ job: "SYNC", status: "PARTIAL" });
    const sent = alerts.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("3 pedidos entraram em erro");
    expect(sent[0].lines.join("\n")).toEqual(expect.stringContaining("Pedido 14103"));

    // Mesmo erro de novo não repete o alerta.
    await call(runRoute, "POST", "/api/sync/run", { body: { job: "SYNC" } });
    expect(alerts.sent.length).toBe(before + 1);

    await call(runRoute, "POST", "/api/sync/run", { body: { job: "RECONCILE" } });
    await call(runRoute, "POST", "/api/sync/run", { body: { job: "RECONCILE" } });
    expect(alerts.sent.at(-1)!.title).toBe("Nota do pedido 14105 rejeitada");

    const runs = (await call(runsRoute, "GET", "/api/sync/runs?limit=10")).body.runs as Json[];
    expect(runs.length).toBeGreaterThanOrEqual(4);
    const logs = await call(runLogsRoute, "GET", "/x", { params: { id: run.body.run.id } });
    expect(logs.body.logs.length).toBeGreaterThan(0);
    expect((await audit("?entityType=SYNC")).map((e) => e.action)).toEqual(expect.arrayContaining(["sync.run", "sync.reconcile"]));
    expect((await call(dashboardRoute, "GET", "/api/dashboard")).body.stats.totals.all).toBe(8);
    expect((await call(paymentFormsRoute, "GET", "/api/settings/payment-forms")).body.forms.map((f: Json) => f.code)).toEqual(expect.arrayContaining([2, 10]));
  });

  it("pedidos: lista, detalhe, 404, simulação, reenvio, ignorar e ciência ficam registrados com o autor", async () => {
    const errors = await call(ordersRoute, "GET", "/api/orders?status=ERROR&pageSize=50");
    const byCode = (code: number) => errors.body.items.find((i: Json) => i.visionOrderCode === code);
    const mapping = byCode(14103);
    expect(mapping.lastError.category).toBe("MAPPING");
    expect((await call(orderRoute, "GET", "/x", { params: { id: "00000000-0000-4000-8000-000000000000" } })).status).toBe(404);
    const detail = await call(orderRoute, "GET", "/x", { params: { id: mapping.id } });
    expect(detail.body.order.visionOrderCode).toBe(14103);
    expect((await call(previewRoute, "GET", "/x", { params: { id: mapping.id } })).body.documents.map((d: Json) => d.type)).toEqual(["CUSTOMER", "SALES_ORDER"]);

    const retry = await call(orderRetryRoute, "POST", "/x", { headers: ANA, params: { id: mapping.id } });
    expect(retry.body.ok).toBe(false);
    const timeline = await app.queries.logs({ orderId: mapping.id });
    expect(timeline.some((l) => l.message === "Reenvio manual iniciado por ana@ecolife.com.br.")).toBe(true);

    await call(ignoreRoute, "POST", "/x", { headers: ANA, params: { id: mapping.id }, body: { ignored: true, reason: "pedido de teste" } });
    expect((await call(orderRoute, "GET", "/x", { params: { id: mapping.id } })).body.order.status).toBe("IGNORED");
    await call(ignoreRoute, "POST", "/x", { params: { id: mapping.id }, body: { ignored: false } });
    await call(ackRoute, "POST", "/x", { params: { id: mapping.id } });
    const bulk = await call(bulkRetryRoute, "POST", "/api/orders/retry", { headers: ANA, body: { category: "ROUTING" } });
    expect(bulk.body).toMatchObject({ total: 1, succeeded: 0 });

    const events = await audit("?entityType=ORDER");
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["order.retry", "order.ignore", "order.unignore", "order.acknowledge", "order.retry-bulk"]));
    expect(events.find((e) => e.action === "order.ignore").summary).toBe("Pedido 14103 ignorado: pedido de teste.");
    expect(events.find((e) => e.action === "order.retry-bulk").summary).toBe("Reenvio em lote (Roteamento para a conta Omie): 0 de 1 concluído(s).");
  });

  it("janela da coleta: consulta e recomeço auditado", async () => {
    expect((await call(collectionRoute, "GET", "/api/sync/collection")).body.collection.started).toBe(true);
    const restarted = await call(collectionRoute, "DELETE", "/api/sync/collection", { headers: ANA });
    expect(restarted.body.collection.started).toBe(false);
    expect((await audit("?search=sync.collection.restart"))[0].actor).toBe("ana@ecolife.com.br");
  });

  it("webhook do Omie: exige o token, grava e enfileira, não duplica pelo messageId; fila e reprocessamento pela API", async () => {
    expect((await call(webhookRoute, "POST", "/api/webhooks/omie?token=errado", { body: {} })).status).toBe(401);
    const order = (await call(ordersRoute, "GET", "/api/orders?search=14100")).body.items[0];
    const omieId = (await call(orderRoute, "GET", "/x", { params: { id: order.id } })).body.order.documentsFull[0].omieId;
    const payload = { messageId: "msg-api-1", topic: "VendaProduto.Faturada", appKey: COMPANIES.matriz.appKey, event: { idPedido: omieId } };
    const first = await call(webhookRoute, "POST", "/api/webhooks/omie?token=token-webhook-teste", { body: payload });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, duplicate: false, queued: true });
    const again = await call(webhookRoute, "POST", "/api/webhooks/omie?token=token-webhook-teste", { body: payload });
    expect(again.body).toMatchObject({ ok: true, duplicate: true, eventId: first.body.eventId });

    await (app.webhookQueue as unknown as { idle(): Promise<void> }).idle();
    const events = await call(webhookEventsRoute, "GET", "/api/webhooks/events?status=DONE");
    expect(events.body.queue).toMatchObject({ mode: "memory", available: true, webhookEnabled: true });
    expect(events.body.items).toEqual([expect.objectContaining({ id: first.body.eventId, visionOrderCode: 14100, topic: "VendaProduto.Faturada" })]);

    const retried = await call(webhookRetryRoute, "POST", "/api/webhooks/events/retry", { headers: ANA, body: {} });
    expect(retried.body).toEqual({ queued: 0 });
    expect((await audit("?search=webhook.retry"))[0]).toMatchObject({ actor: "ana@ecolife.com.br", summary: "0 webhook(s) do Omie com falha recolocado(s) na fila." });
  });

  it("erro inesperado: 500 com o código da requisição, registrado no logger estruturado", async () => {
    const spy = vi.spyOn(app.logger, "error");
    const original = app.queries.list;
    app.queries.list = async () => {
      throw new Error("conexão perdida com o banco");
    };
    try {
      const response = await call(ordersRoute, "GET", "/api/orders", { headers: { "x-request-id": "req-500-teste" } });
      expect(response.status).toBe(500);
      expect(response.body.error).toMatchObject({ code: "INTERNAL", requestId: "req-500-teste" });
      expect(response.body.error.message).toContain("req-500-teste");
      expect(response.body.error.message).not.toContain("conexão perdida");
      expect(spy).toHaveBeenCalledWith("Erro inesperado na API", expect.objectContaining({ requestId: "req-500-teste", path: "/api/orders", error: "conexão perdida com o banco" }));
    } finally {
      app.queries.list = original;
      spy.mockRestore();
    }
  });

  it("retenção: apaga logs antigos (erros ficam mais tempo) e registra a limpeza", async () => {
    const day = 86_400_000;
    const now = Date.now();
    await app.database.db.insert(integrationLogs).values([
      { orderId: null, runId: null, level: "INFO", step: null, message: "antigo (info)", data: null, createdAt: new Date(now - 100 * day) },
      { orderId: null, runId: null, level: "ERROR", step: null, message: "antigo (erro dentro do prazo)", data: null, createdAt: new Date(now - 100 * day) },
      { orderId: null, runId: null, level: "ERROR", step: null, message: "antigo (erro vencido)", data: null, createdAt: new Date(now - 400 * day) },
    ]);
    const result = await app.useCases.maintenance.execute();
    expect(result).toMatchObject({ logs: 2 });
    const remaining = await app.database.db.select({ message: integrationLogs.message }).from(integrationLogs);
    expect(remaining.map((r) => r.message)).toContain("antigo (erro dentro do prazo)");
    expect((await audit("?entityType=SYSTEM"))[0]).toMatchObject({ actor: "sistema", action: "logs.purge" });
  });
});
