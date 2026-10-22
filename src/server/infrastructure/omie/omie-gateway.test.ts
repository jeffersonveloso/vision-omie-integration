import { describe, expect, it } from "vitest";
import type { CallRecorder, ExternalCallRecord } from "@/server/modules/integration/application/ports";
import { OmieGatewayFactoryImpl } from "./omie-gateway";
import { OmieRateLimiter } from "./omie-rate-limiter";

type Handler = (call: string, param: Record<string, unknown>, service: string) => { status?: number; body: unknown };

/** Omie de mentira: cada teste responde por serviço/método. */
function gateway(handler: Handler) {
  const records: ExternalCallRecord[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const service = String(url).replace(/^.*\/api\/v1\//, "").replace(/\/$/, "");
    const res = handler(body.call, body.param[0], service);
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const factory = new OmieGatewayFactoryImpl({ baseUrl: "https://omie.test/api/v1", timeoutMs: 5000, maxInlineRetries: 0, readCacheTtlMs: 0 }, new OmieRateLimiter({ readConcurrency: 2, minIntervalMs: 0 }), fetchImpl);
  const recorder: CallRecorder = (r) => records.push(r);
  return { gw: factory.forAccount({ appKey: "KEY", appSecret: "SECRET" }, recorder), records };
}

const chave = "31261011222333000181550010000012341000012345";

describe("Omie: situação da NF-e (StatusPedido)", () => {
  it("autorizada: chave de 44 dígitos e protocolo", async () => {
    const { gw } = gateway(() => ({ body: { etapa: "60", ListaNfe: [{ numero_nfe: "1234", serie_nfe: "1", chave_nfe: chave, protocolo: "131260000012345", data_emissao: "21/10/2026", hora_emissao: "10:15:00", danfe: "https://pdf" }] } }));
    expect(await gw.getSalesOrderFiscal(1)).toMatchObject({ state: "AUTHORIZED", invoiceNumber: "1234", accessKey: chave, authorizedAt: "2026-10-21T10:15:00", pdfUrl: "https://pdf" });
  });

  it("cancelada", async () => {
    const { gw } = gateway(() => ({ body: { cancelada: "S", ListaNfe: [{ numero_nfe: "1234", chave_nfe: chave, protocolo: "1" }] } }));
    expect(await gw.getSalesOrderFiscal(1)).toMatchObject({ state: "CANCELLED", invoiceNumber: "1234" });
  });

  it("rejeitada: código e motivo das mensagens", async () => {
    const { gw } = gateway(() => ({ body: { ListaNfe: [{ status_nfe: "Rejeitada", mensagens: [{ cCodigo: "539", cDescricao: "Duplicidade de NF-e", cCorrecao: "Verifique a numeração" }] }] } }));
    expect(await gw.getSalesOrderFiscal(1)).toMatchObject({ state: "REJECTED", rejectionCode: "539", rejectionMessage: "Duplicidade de NF-e — Verifique a numeração" });
  });

  it("em processamento continua pendente", async () => {
    const { gw } = gateway(() => ({ body: { ListaNfe: [{ status_nfe: "Em processamento", mensagens: [] }] } }));
    expect((await gw.getSalesOrderFiscal(1)).state).toBe("PENDING");
  });
});

describe("Omie: situação da NFS-e (StatusOS)", () => {
  it("emitida", async () => {
    const { gw } = gateway(() => ({ body: { cEtapa: "60", dDtFat: "21/10/2026", cHrFat: "11:00:00", ListaRpsNfse: [{ nNfse: "55", nRps: "12", cCodVerif: "AB12", cUrlPdfDest: "https://nfse" }] } }));
    expect(await gw.getServiceOrderFiscal(1)).toMatchObject({ state: "AUTHORIZED", invoiceNumber: "55", rpsNumber: "12", verificationCode: "AB12", pdfUrl: "https://nfse" });
  });

  it("cancelada, com data do cancelamento", async () => {
    const { gw } = gateway(() => ({ body: { cCancelada: "S", dDtCanc: "22/10/2026", cHrCanc: "08:00:00", ListaRpsNfse: [{ nNfse: "55" }] } }));
    expect(await gw.getServiceOrderFiscal(1)).toMatchObject({ state: "CANCELLED", cancelledAt: "2026-10-22T08:00:00" });
  });

  it("rejeitada pela prefeitura", async () => {
    const { gw } = gateway(() => ({ body: { ListaRpsNfse: [{ nNfse: "0", nRps: "13", cStatusRps: "Erro", mensagens: [{ cSituacao: "Erro", cCodigo: "E160", cDescricao: "Código do serviço inválido" }] }] } }));
    expect(await gw.getServiceOrderFiscal(1)).toMatchObject({ state: "REJECTED", rpsNumber: "13", rejectionCode: "E160", rejectionMessage: "Código do serviço inválido" });
  });

  it("aguardando envio continua pendente", async () => {
    const { gw } = gateway(() => ({ body: { ListaRpsNfse: [{ nNfse: "0", cStatusRps: "Aguardando envio", mensagens: [] }] } }));
    expect((await gw.getServiceOrderFiscal(1)).state).toBe("PENDING");
  });
});

describe("Omie: inclusão idempotente", () => {
  it("pedido já cadastrado com o código de integração é vinculado, sem erro", async () => {
    const { gw } = gateway((call) =>
      call === "IncluirPedido"
        ? { status: 500, body: { faultstring: "ERROR: Pedido já cadastrado para o Código de Integração [VIS-14100]!", faultcode: "SOAP-ENV:Client-102" } }
        : { body: { codigo_pedido: 987, numero_pedido: "000123" } },
    );
    expect(await gw.createSalesOrder({ cabecalho: { codigo_pedido_integracao: "VIS-14100" } })).toMatchObject({ omieId: 987, number: "000123" });
  });

  it("OS inexistente na consulta prévia volta null; outras falhas sobem classificadas", async () => {
    const notFound = gateway(() => ({ status: 500, body: { faultstring: "ERROR: Não existem registros para a página [1]!" } }));
    expect(await notFound.gw.findServiceOrder("VIS-1-OS")).toBeNull();
    const auth = gateway(() => ({ status: 500, body: { faultstring: "ERROR: A chave de acesso não está preenchida ou não é válida." } }));
    await expect(auth.gw.findServiceOrder("VIS-1-OS")).rejects.toMatchObject({ category: "OMIE_AUTH", retryable: false });
    const down = gateway(() => ({ status: 503, body: {} }));
    await expect(down.gw.getSalesOrderFiscal(1)).rejects.toMatchObject({ category: "OMIE_UNAVAILABLE", retryable: true });
  });
});

describe("Omie: títulos e baixas (ListarMovimentos)", () => {
  it("monta títulos com parcelas e baixas, e para na página vazia", async () => {
    const { gw, records } = gateway((_call, param) =>
      param.nPagina === 1
        ? {
            body: {
              movimentos: [
                { detalhes: { nCodTitulo: 70, cNumTitulo: "123", cNumParcela: "001/002", nValorTitulo: 250, dDtVenc: "10/11/2026", cStatus: "RECEBIDO", nCodBaixa: 900, dDtPagamento: "05/11/2026", nValorMovCC: 250, nCodCC: 11850365 }, resumo: { nValAberto: 0 } },
                { detalhes: { nCodTitulo: 71, cNumTitulo: "123", cNumParcela: "002/002", nValorTitulo: 250, dDtVenc: "10/12/2026", cStatus: "A VENCER" }, resumo: { nValAberto: 250 } },
              ],
            },
          }
        : { status: 500, body: { faultstring: "ERROR: Não existem registros para a página [2]!" } },
    );
    const titles = await gw.listFinancialTitles(987);
    expect(titles.map((t) => [t.omieTitleId, t.parcelNumber, t.openAmount, t.payments.length])).toEqual([
      [70, 1, 0, 1],
      [71, 2, 250, 0],
    ]);
    expect(titles[0].payments[0]).toMatchObject({ omieBaixaId: 900, amount: 250, bankAccountId: 11850365 });
    // App Key e App Secret nunca aparecem no registro das chamadas.
    expect(JSON.stringify(records)).not.toContain("SECRET");
  });
});
