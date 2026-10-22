import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPANIES } from "../scripts/simulators/fixtures";
import { type OmieSimulator, startOmieSimulator } from "../scripts/simulators/omie-simulator";
import { startVisionSimulator, type VisionSimulator } from "../scripts/simulators/vision-simulator";
import { buildContainer, type AppContainer } from "@/server/container";
import { OmieGatewayFactoryImpl } from "@/server/infrastructure/omie/omie-gateway";
import { OmieRateLimiter } from "@/server/infrastructure/omie/omie-rate-limiter";
import { VisionApiClient } from "@/server/infrastructure/vision/vision-api-client";

/**
 * Fluxo ponta a ponta contra os simuladores HTTP (mesmo contrato das APIs reais)
 * e banco PostgreSQL embarcado (PGlite em memória).
 */
describe("Fluxo de integração Vision ↔ Omie", () => {
  let vision: VisionSimulator;
  let omie: OmieSimulator;
  let app: AppContainer;
  const accountIds: Record<string, string> = {};

  const orderByCode = async (code: number) => {
    const list = await app.queries.list({ search: String(code), page: 1, pageSize: 5 });
    const item = list.items.find((i) => i.visionOrderCode === code);
    if (!item) throw new Error(`pedido ${code} não encontrado`);
    return item;
  };

  beforeAll(async () => {
    vision = await startVisionSimulator(0);
    omie = await startOmieSimulator(0);
    omie.rejectIntegrationCodes.add("VIS-14105");
    omie.payIntegrationCodes.add("VIS-14106");
    omie.dropResponseOnce.add("VIS-14101-OS");
    app = await buildContainer({
      databaseUrl: "pglite:memory",
      vision: new VisionApiClient({ baseUrl: vision.url, username: "OMIE", password: "simulador", timeoutMs: 5000, timeZone: "America/Sao_Paulo" }),
      omie: new OmieGatewayFactoryImpl({ baseUrl: omie.url, timeoutMs: 5000, maxInlineRetries: 2, readCacheTtlMs: 0 }, new OmieRateLimiter({ readConcurrency: 2, minIntervalMs: 0 })),
    });
  });

  afterAll(async () => {
    await vision?.close();
    await omie?.close();
    await app?.database.close();
  });

  it("cadastra as contas Omie e valida CNPJ × base na conexão", async () => {
    for (const [key, company] of Object.entries({ matriz: COMPANIES.matriz, filial: COMPANIES.filial })) {
      const account = await app.omieAccounts.create({ name: company.name, appKey: company.appKey, appSecret: company.appSecret, cnpj: company.cnpj, description: `Base ${key}`, active: true });
      accountIds[key] = account.id;
      const test = await app.omieAccounts.testConnection(account.id);
      expect(test.ok).toBe(true);
    }
    await expect(app.omieAccounts.create({ name: "Duplicada", appKey: "x", appSecret: "y", cnpj: COMPANIES.matriz.cnpj, active: true })).rejects.toThrow(/já está cadastrado/);
    const lookups = await app.omieAccounts.lookup(accountIds.matriz, "categorias");
    expect(lookups.options.map((o) => o.value)).toContain("1.01.02");
    expect(lookups.options.map((o) => o.value)).not.toContain("1.01"); // totalizadora
  });

  it("configura o mapeamento dinâmico (regras globais + de-para por conta)", async () => {
    for (const doc of ["SALES_ORDER", "SERVICE_ORDER"] as const) {
      const prefix = doc === "SALES_ORDER" ? "informacoes_adicionais." : "InformacoesAdicionais.";
      await app.mappingAdmin.saveRule({ omieAccountId: null, documentType: doc, targetField: `${prefix}${doc === "SALES_ORDER" ? "codigo_categoria" : "cCodCateg"}`, sourceType: "CONSTANT", constantValue: doc === "SALES_ORDER" ? "1.01.01" : "1.01.02", transforms: [], active: true, notes: null });
      await app.mappingAdmin.saveRule({ omieAccountId: null, documentType: doc, targetField: `${prefix}${doc === "SALES_ORDER" ? "codigo_conta_corrente" : "nCodCC"}`, sourceType: "CONSTANT", constantValue: "11850365", transforms: [], active: true, notes: null });
    }
    const maps = await app.mappingAdmin.listMaps();
    const produtos = maps.find((m) => m.key === "produtos")!;
    const servicos = maps.find((m) => m.key === "servicos")!;
    // O Vision não manda o CNPJ da empresa no pedido: roteamento pelo código da empresa.
    const empresas = maps.find((m) => m.key === "empresa-cnpj")!;
    await app.mappingAdmin.upsertEntry({ valueMapId: empresas.id, omieAccountId: accountIds.matriz, visionValue: String(COMPANIES.matriz.code), omieValue: COMPANIES.matriz.cnpj });
    await app.mappingAdmin.upsertEntry({ valueMapId: empresas.id, omieAccountId: accountIds.filial, visionValue: String(COMPANIES.filial.code), omieValue: COMPANIES.filial.cnpj });
    for (const accountId of Object.values(accountIds)) {
      await app.mappingAdmin.importEntries(produtos.id, accountId, "valor vision;valor omie\n123;4422421;Coletor\n456;4422456;Kit");
      await app.mappingAdmin.upsertEntry({ valueMapId: servicos.id, omieAccountId: accountId, visionValue: "77", omieValue: "8800077" });
      await app.mappingAdmin.upsertEntry({ valueMapId: servicos.id, omieAccountId: accountId, visionValue: "78", omieValue: "8800078" });
    }
    const rules = await app.mappingAdmin.listEffectiveRules("SALES_ORDER", accountIds.matriz);
    expect(rules.find((r) => r.key === "informacoes_adicionais.codigo_categoria")?.origin).toBe("GLOBAL");
  });

  it("coleta no Vision, roteia pela empresa e envia PV/OS ao Omie, registrando erros claros", async () => {
    const run = await app.useCases.syncJob.execute({ trigger: "MANUAL" });
    expect(run.status).toBe("PARTIAL");
    expect(run.stats.discovered).toBe(8);

    expect((await orderByCode(14100)).status).toBe("SENT");
    expect((await orderByCode(14101)).status).toBe("SENT"); // resposta perdida + reenvio → vinculado sem duplicar
    const both = await orderByCode(14102);
    expect(both.status).toBe("SENT");
    expect(both.documents.map((d) => d.kind).sort()).toEqual(["SALES_ORDER", "SERVICE_ORDER"]);
    expect(both.omieAccountName).toBe(COMPANIES.filial.name);

    const mapping = await orderByCode(14103);
    expect(mapping.status).toBe("ERROR");
    expect(mapping.lastError?.category).toBe("MAPPING");
    expect(mapping.lastError?.message).toContain('"999"');
    expect(mapping.lastError?.hint).toContain("Produtos");

    const routing = await orderByCode(14104);
    expect(routing.status).toBe("ERROR");
    expect(routing.lastError?.category).toBe("ROUTING");
    expect(routing.lastError?.message).toContain(`a empresa ${COMPANIES.semConta.code}`);
    expect(routing.lastError?.hint).toContain("Empresa Vision → CNPJ");

    const lineTotal = await orderByCode(14107);
    expect(lineTotal.status).toBe("ERROR");
    expect(lineTotal.lastError?.category).toBe("VALIDATION");
    expect(lineTotal.lastError?.code).toBe("LINE_TOTAL_MISMATCH");
    expect(lineTotal.lastError?.message).toContain("1.408,70");
    expect(lineTotal.lastError?.message).toContain("1.403,78");

    const matrizApp = omie.apps.get(COMPANIES.matriz.appKey)!;
    expect(matrizApp.documents.filter((d) => d.integrationCode === "VIS-14101-OS")).toHaveLength(1);
    const sales = matrizApp.documents.find((d) => d.integrationCode === "VIS-14100")!;
    expect((sales.payload.lista_parcelas as { parcela: unknown[] }).parcela).toHaveLength(2);
    expect((sales.payload.cabecalho as Record<string, unknown>).codigo_parcela).toBe("999");
  });

  it("a linha do tempo mostra cada etapa e as chamadas externas com request/response", async () => {
    const order = await orderByCode(14103);
    const logs = await app.queries.logs({ orderId: order.id });
    expect(logs.some((l) => l.step === "MAP" && l.level === "ERROR")).toBe(true);
    expect(logs.some((l) => l.data?.kind === "external-call" && String(l.message).includes("/api/pedido/busca/14103"))).toBe(true);
    const sent = await orderByCode(14100);
    const sentLogs = await app.queries.logs({ orderId: sent.id });
    const include = sentLogs.find((l) => String(l.message).includes("IncluirPedido"));
    expect(JSON.stringify(include?.data)).not.toContain(COMPANIES.matriz.appSecret);
  });

  it("acompanha o faturamento no Omie e devolve autorização, rejeição e baixas ao Vision", async () => {
    await app.useCases.reconcileJob.execute({ trigger: "MANUAL" }); // 1ª consulta: aguardando faturamento
    expect((await orderByCode(14100)).status).toBe("SENT");
    await app.useCases.reconcileJob.execute({ trigger: "MANUAL" }); // 2ª: NF autorizada / rejeitada
    expect((await orderByCode(14100)).status).toBe("COMPLETED");
    expect((await orderByCode(14101)).status).toBe("COMPLETED");
    expect((await orderByCode(14102)).status).toBe("COMPLETED");
    const rejected = await orderByCode(14105);
    expect(rejected.status).toBe("REJECTED");

    const auth = vision.returns.filter((r) => r.endpoint === "/api/pedido/nota/autorizacao");
    const authFor14102 = auth.filter((r) => r.body.codigoPedido === 14102);
    expect(authFor14102.map((r) => r.body.tipoNotaFiscal).sort()).toEqual([0, 1]);
    const authFor14100 = auth.find((r) => r.body.codigoPedido === 14100)!;
    expect(String(authFor14100.body.chaveAcesso)).toHaveLength(44);
    expect((authFor14100.body.parcelas as Array<{ codigoParcela: number }>).map((p) => p.codigoParcela)).toEqual([9001, 9002]);
    expect(authFor14100.body.xmlNotaBase64).toBeTruthy();

    const rejection = vision.returns.find((r) => r.endpoint === "/api/pedido/nota/rejeicao")!;
    expect(rejection.body.codigoPedido).toBe(14105);
    expect(rejection.body.codigoMotivoRejeicao).toBe("539");

    // baixa da 1ª parcela do 14106 aparece no Omie após a autorização
    const settings = await app.settings.get();
    await app.settings.update({ ...settings, visionReturn: { ...settings.visionReturn, defaultCodigoContaCorrente: 1 } });
    await app.useCases.reconcileJob.execute({ trigger: "MANUAL" });
    const baixa = vision.returns.find((r) => r.endpoint === "/api/pedido/parcela/baixa")!;
    expect(baixa.body).toMatchObject({ codigoPedido: 14106, codigoParcela: 9060, valorPagamento: 250, codigoContaCorrente: 1 });

    // nada é retornado duas vezes
    const before = vision.returns.length;
    await app.useCases.reconcileJob.execute({ trigger: "MANUAL" });
    expect(vision.returns.length).toBe(before);
  });

  it("reenvio manual depois de corrigir o de-para conclui o pedido", async () => {
    const produtos = (await app.mappingAdmin.listMaps()).find((m) => m.key === "produtos")!;
    await app.mappingAdmin.upsertEntry({ valueMapId: produtos.id, omieAccountId: accountIds.matriz, visionValue: "999", omieValue: "4422999" });
    const order = await orderByCode(14103);
    const result = await app.useCases.retryOrder.execute({ orderId: order.id });
    expect(result.ok).toBe(true);
    expect((await orderByCode(14103)).status).toBe("SENT");
  });

  it("pedido sem financeiro com quantidade arredondada: recalcula, escolhe a condição e conclui", async () => {
    const settings = await app.settings.get();
    await app.settings.update({ ...settings, documents: { ...settings.documents, lineTotalMismatch: "ADJUST_QUANTITY" } });
    const order = await orderByCode(14107);

    // Com a quantidade recalculada, falta a condição de pagamento: 999 exige parcelas e o pedido não tem.
    await app.useCases.retryOrder.execute({ orderId: order.id });
    const noParcels = await orderByCode(14107);
    expect(noParcels.lastError?.category).toBe("MAPPING");
    expect(noParcels.lastError?.code).toBe("NO_INSTALLMENTS");
    expect(noParcels.lastError?.message).toContain("SEM FINANCEIRO");

    await app.mappingAdmin.saveRule({ omieAccountId: accountIds.matriz, documentType: "SERVICE_ORDER", targetField: "Cabecalho.cCodParc", sourceType: "CONSTANT", constantValue: "000", transforms: [], active: true, notes: "Pedidos sem financeiro" });
    const result = await app.useCases.retryOrder.execute({ orderId: order.id });
    expect(result.ok).toBe(true);
    const os = omie.apps.get(COMPANIES.matriz.appKey)!.documents.find((d) => d.integrationCode === "VIS-14107-OS")!;
    const line = (os.payload.ServicosPrestados as Array<Record<string, unknown>>)[0];
    expect(line).toMatchObject({ nCodServico: 8800077, nQtde: 271.9498, nValUnit: 5.18 });
    expect(os.payload.Parcelas).toBeUndefined();
    expect((os.payload.Cabecalho as Record<string, unknown>).cCodParc).toBe("000");

    await app.useCases.reconcileJob.execute({ trigger: "MANUAL" });
    await app.useCases.reconcileJob.execute({ trigger: "MANUAL" });
    expect((await orderByCode(14107)).status).toBe("COMPLETED");
    const auth = vision.returns.find((r) => r.endpoint === "/api/pedido/nota/autorizacao" && r.body.codigoPedido === 14107)!;
    expect(auth.body.parcelas).toEqual([]);

    // Sem parcelas e sem títulos não há o que acompanhar: o Omie não é mais consultado para essa OS.
    const omieId = (await app.queries.detail(order.id))?.documentsFull.find((d) => d.kind === "SERVICE_ORDER")?.omieId;
    const callsBefore = omie.calls.filter((c) => c.param.nCodOS === omieId).length;
    await app.useCases.reconcileJob.execute({ trigger: "MANUAL" });
    expect(omie.calls.filter((c) => c.param.nCodOS === omieId).length).toBe(callsBefore);
  });

  it("lista concluídos sem erro e conta por status", async () => {
    const completed = await app.queries.list({ status: ["COMPLETED"], page: 1, pageSize: 50 });
    expect(completed.items.map((i) => i.visionOrderCode).sort()).toEqual([14100, 14101, 14102, 14103, 14106, 14107]);
    expect(completed.counts.ERROR).toBe(1);
    const stats = await app.queries.stats();
    expect(stats.totals.all).toBe(8);
    expect(stats.errorsByCategory[0]).toMatchObject({ category: "ROUTING", count: 1 });
  });

  it("simulação de mapeamento mostra o payload sem chamar o Omie", async () => {
    const order = await orderByCode(14102);
    const callsBefore = omie.calls.length;
    const preview = await app.useCases.preview.execute({ orderId: order.id });
    expect(omie.calls.length).toBe(callsBefore);
    expect(preview.documents.map((d) => d.type)).toEqual(["CUSTOMER", "SALES_ORDER", "SERVICE_ORDER"]);
    const os = preview.documents.find((d) => d.type === "SERVICE_ORDER")!;
    expect((os.payload.InformacoesAdicionais as Record<string, unknown>).cCidPrestServ).toBe("PEDRO LEOPOLDO (MG)");
  });
});
