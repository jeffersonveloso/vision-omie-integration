import { describe, expect, it } from "vitest";
import { IntegrationError } from "./integration-error";
import { IntegrationOrder } from "./integration-order";
import type { FiscalSnapshot } from "./omie-document";
import { matchTitlesToVisionParcels } from "./parcel-matching";

const now = new Date("2026-10-21T12:00:00Z");
const policy = { maxAutoRetries: 3, backoffMinutes: [2, 10, 30] };

function order() {
  const o = IntegrationOrder.discover({ code: 14100, companyCode: 1, statusCode: 2, statusDescription: "Aprovado", updatedAt: new Date("2026-10-20T10:00:00Z"), customerName: "Cliente", raw: {} }, "o1", now);
  o.ensureDocuments([{ kind: "SALES_ORDER", integrationCode: "VIS-14100" }, { kind: "SERVICE_ORDER", integrationCode: "VIS-14100-OS" }], (() => { let i = 0; return () => `d${++i}`; })(), now);
  return o;
}

const authorized = (n: string): FiscalSnapshot => ({ state: "AUTHORIZED", invoiceNumber: n, series: "1", accessKey: `3126${n.padStart(40, "0")}`, protocol: "1312600000001", rpsNumber: null, verificationCode: null, authorizedAt: "2026-10-21T10:00:00", cancelledAt: null, rejectionCode: null, rejectionMessage: null, pdfUrl: null, xml: "<xml/>", omieStage: "60" });

describe("IntegrationOrder", () => {
  it("começa na fila e fica pendente enquanto houver documento não enviado", () => {
    const o = order();
    o.recomputeStatus(now);
    expect(o.status).toBe("PENDING");
    o.document("SALES_ORDER")!.markSent(1, "100", null, now);
    o.recordSuccess("SEND", now);
    expect(o.status).toBe("PENDING");
    o.document("SERVICE_ORDER")!.markSent(2, "200", null, now);
    o.recordSuccess("SEND", now);
    expect(o.status).toBe("SENT");
  });

  it("agenda nova tentativa com backoff só para erros transitórios", () => {
    const o = order();
    o.recordFailure(new IntegrationError({ category: "OMIE_UNAVAILABLE", code: "HTTP_503", message: "fora", retryable: true, step: "SEND_SALES_ORDER" }), policy, now);
    expect(o.status).toBe("ERROR");
    expect(o.nextRetryAt?.toISOString()).toBe("2026-10-21T12:02:00.000Z");
    o.recordFailure(new IntegrationError({ category: "MAPPING", code: "X", message: "sem de-para", retryable: false, step: "MAP" }), policy, now);
    expect(o.nextRetryAt).toBeNull();
    expect(o.attempts).toBe(2);
  });

  it("só sinaliza alteração no Vision depois do envio quando a data de atualização muda", () => {
    const o = order();
    const summary = { code: 14100, companyCode: 1, statusCode: 2, statusDescription: "Aprovado", customerName: "Cliente", raw: {} };
    expect(o.refreshSummary({ ...summary, updatedAt: new Date("2026-10-20T10:00:00Z") }, now)).toBe("UNCHANGED");
    expect(o.refreshSummary({ ...summary, updatedAt: new Date("2026-10-20T11:00:00Z") }, now)).toBe("REFRESHED");
    o.document("SALES_ORDER")!.markSent(1, "100", null, now);
    expect(o.refreshSummary({ ...summary, updatedAt: null }, now)).toBe("UNCHANGED");
    expect(o.updatedAfterSync).toBe(false);
    expect(o.refreshSummary({ ...summary, updatedAt: new Date("2026-10-21T09:00:00Z") }, now)).toBe("UPDATED_AFTER_SYNC");
    expect(o.updatedAfterSync).toBe(true);
  });

  it("sucesso do retorno não apaga erro de envio", () => {
    const o = order();
    o.document("SALES_ORDER")!.markSent(1, "100", null, now);
    o.recordFailure(new IntegrationError({ category: "MAPPING", code: "X", message: "OS sem de-para", step: "MAP" }), policy, now);
    o.recordSuccess("RETURN", now);
    expect(o.status).toBe("ERROR");
    o.recordSuccess("SEND", now);
    expect(o.lastError).toBeNull();
  });

  it("conclui quando todas as notas foram autorizadas e retornadas ao Vision", () => {
    const o = order();
    const pv = o.document("SALES_ORDER")!;
    const os = o.document("SERVICE_ORDER")!;
    pv.markSent(1, "100", null, now);
    os.markSent(2, "200", null, now);
    pv.applyFiscal(authorized("1001"), now);
    os.applyFiscal(authorized("55"), now);
    o.recordSuccess("RETURN", now);
    expect(o.status).toBe("SENT");
    for (const doc of [pv, os]) for (const p of doc.pendingFiscalReturns()) doc.markFiscalReturned(p.kind, p.signature, now);
    o.recordSuccess("RETURN", now);
    expect(o.status).toBe("COMPLETED");
  });

  it("rejeição é retornada uma única vez por motivo", () => {
    const o = order();
    const pv = o.document("SALES_ORDER")!;
    pv.markSent(1, "100", null, now);
    pv.applyFiscal({ ...authorized("1"), state: "REJECTED", accessKey: null, rejectionCode: "539", rejectionMessage: "Duplicidade de NF-e" }, now);
    const pending = pv.pendingFiscalReturns();
    expect(pending.map((p) => p.kind)).toEqual(["rejection"]);
    pv.markFiscalReturned("rejection", pending[0].signature, now);
    expect(pv.pendingFiscalReturns()).toEqual([]);
  });

  it("detecta cancelamento de baixa quando ela some do Omie", () => {
    const o = order();
    const pv = o.document("SALES_ORDER")!;
    pv.markSent(1, "100", null, now);
    const payment = { omieBaixaId: 900, paidAt: "2026-10-25", amount: 100, interest: 0, discount: 0, fine: 0, bankAccountId: 5 };
    pv.syncTitles([{ omieTitleId: 10, titleNumber: "100/1", parcelLabel: "001/001", parcelNumber: 1, amount: 100, openAmount: 0, dueDate: "25/10/2026", status: "RECEBIDO", createdAt: null, payments: [payment] }], now);
    expect(pv.pendingPaymentReturns()).toHaveLength(1);
    pv.markPaymentReturned(900, 77, now);
    pv.syncTitles([{ omieTitleId: 10, titleNumber: "100/1", parcelLabel: "001/001", parcelNumber: 1, amount: 100, openAmount: 100, dueDate: "25/10/2026", status: "A VENCER", createdAt: null, payments: [] }], now);
    const cancellations = pv.pendingPaymentCancellations();
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0].payment.visionBaixaCode).toBe(77);
  });
});

describe("matchTitlesToVisionParcels", () => {
  const title = (id: number, n: number, due: string) => ({ omieTitleId: id, titleNumber: null, parcelLabel: null, parcelNumber: n, amount: 50, openAmount: 50, dueDate: due, status: null, visionParcelCode: null, payments: [] });
  it("pareia pela ordem quando a quantidade bate", () => {
    const map = matchTitlesToVisionParcels([title(1, 1, "10/11/2026"), title(2, 2, "10/12/2026")], [{ code: 902, dueDate: "2026-12-10T00:00:00", amount: 50 }, { code: 901, dueDate: "2026-11-10T00:00:00", amount: 50 }], "America/Sao_Paulo");
    expect(map.get(1)).toBe(901);
    expect(map.get(2)).toBe(902);
  });
  it("pareia por vencimento quando a quantidade difere", () => {
    const map = matchTitlesToVisionParcels([title(1, 1, "10/11/2026")], [{ code: 901, dueDate: "2026-11-10", amount: 50 }, { code: 902, dueDate: "2026-12-10", amount: 50 }], "America/Sao_Paulo");
    expect(map.get(1)).toBe(901);
  });
});
