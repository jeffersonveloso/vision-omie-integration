import { parseFlexibleDate } from "@/server/shared/domain/dates";
import type { IntegrationSettings } from "@/server/modules/settings/domain/integration-settings";
import type { IntegrationOrder } from "../domain/integration-order";
import type { FinancialPayment, FinancialTitle, FiscalSnapshot, OmieDocument } from "../domain/omie-document";
import type {
  VisionAuthorizationPayload,
  VisionCancellationPayload,
  VisionPaymentCancellationPayload,
  VisionPaymentPayload,
  VisionRejectionPayload,
} from "./ports";

type Conventions = IntegrationSettings["visionReturn"];

function kindConventions(doc: OmieDocument, c: Conventions) {
  const product = doc.kind === "SALES_ORDER";
  return {
    tipo: product ? c.tipoProduto : c.tipoServico,
    tipoNotaFiscal: product ? c.tipoNotaFiscalProduto : c.tipoNotaFiscalServico,
    especie: product ? c.especieProduto : c.especieServico,
    modelo: product ? c.modeloProduto : c.modeloServico,
  };
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = parseFlexibleDate(value);
  return parsed ? parsed.toISOString() : null;
}

/** Monta os payloads da ControllerAPI do Vision (retornos fiscais e financeiros). */
export class VisionReturnBuilder {
  constructor(private readonly conventions: Conventions) {}

  authorization(
    order: IntegrationOrder,
    doc: OmieDocument,
    fiscal: FiscalSnapshot,
    attachments: { pdfBase64?: string; xmlBase64?: string },
    now: Date,
  ): VisionAuthorizationPayload {
    const k = kindConventions(doc, this.conventions);
    const payload = order.visionPayload ?? {};
    return {
      codigoPedido: order.visionOrderCode,
      numeroProtocoloAutorizacao: fiscal.protocol ?? "",
      numeroNotaFiscal: fiscal.invoiceNumber ?? "",
      numeroRPS: fiscal.rpsNumber ?? "",
      especieNotaFiscal: k.especie,
      modeloNotaFiscal: k.modelo,
      serieNotaFiscal: fiscal.series ?? "",
      chaveAcesso: fiscal.accessKey ?? fiscal.verificationCode ?? "",
      tipo: k.tipo,
      dataAutorizacao: isoOrNull(fiscal.authorizedAt) ?? now.toISOString(),
      ...(attachments.pdfBase64 ? { pdfNotaBase64: attachments.pdfBase64 } : {}),
      ...(attachments.xmlBase64 ? { xmlNotaBase64: attachments.xmlBase64 } : {}),
      parcelas: doc.titles.map((t) => this.parcel(order, t, Number(payload.codigoCarteira ?? 0) || 0)),
      codigoIntegracao: this.conventions.codigoIntegracao,
      tipoNotaFiscal: k.tipoNotaFiscal,
    };
  }

  rejection(order: IntegrationOrder, doc: OmieDocument): VisionRejectionPayload {
    const k = kindConventions(doc, this.conventions);
    return {
      codigoPedido: order.visionOrderCode,
      codigoMotivoRejeicao: doc.fiscal?.rejectionCode ?? "",
      descricaoMotivoRejeicao: doc.fiscal?.rejectionMessage ?? "Nota rejeitada no Omie",
      codigoIntegracao: this.conventions.codigoIntegracao,
      tipo: k.tipo,
      tipoNotaFiscal: k.tipoNotaFiscal,
    };
  }

  cancellation(order: IntegrationOrder, doc: OmieDocument, attachments: { pdfBase64?: string; xmlBase64?: string }): VisionCancellationPayload {
    const k = kindConventions(doc, this.conventions);
    const f = doc.fiscal;
    return {
      codigoPedido: order.visionOrderCode,
      justificativaCancelamento: "Documento cancelado no Omie",
      protocoloCancelamento: "",
      ...(attachments.pdfBase64 ? { pdfNotaBase64: attachments.pdfBase64 } : {}),
      ...(attachments.xmlBase64 ? { xmlCancelamentoBase64: attachments.xmlBase64 } : {}),
      codigoIntegracao: this.conventions.codigoIntegracao,
      tipo: k.tipo,
      tipoNotaFiscal: k.tipoNotaFiscal,
      dataAutorizacao: isoOrNull(f?.authorizedAt),
      chaveAcesso: f?.accessKey ?? f?.verificationCode ?? "",
      numeroNotaFiscal: f?.invoiceNumber ?? "",
      numeroProtocoloAutorizacao: f?.protocol ?? "",
      serieNotaFiscal: f?.series ?? "",
      numeroRPS: f?.rpsNumber ?? "",
      especieNotaFiscal: k.especie,
      modeloNotaFiscal: k.modelo,
    };
  }

  payment(order: IntegrationOrder, title: FinancialTitle, payment: FinancialPayment, visionBankAccount: number): VisionPaymentPayload {
    return {
      codigoPedido: order.visionOrderCode,
      codigoParcela: title.visionParcelCode ?? 0,
      dataPagamento: isoOrNull(payment.paidAt) ?? new Date().toISOString(),
      valorPagamento: payment.amount,
      valorJuros: payment.interest + payment.fine,
      valorDesconto: payment.discount,
      codigoContaCorrente: visionBankAccount,
      codigoIntegracao: this.conventions.codigoIntegracao,
    };
  }

  paymentCancellation(order: IntegrationOrder, payment: FinancialPayment): VisionPaymentCancellationPayload {
    return {
      codigoPedido: order.visionOrderCode,
      codigoBaixa: payment.visionBaixaCode ?? payment.omieBaixaId,
      codigoIntegracao: this.conventions.codigoIntegracao,
    };
  }

  private parcel(order: IntegrationOrder, t: FinancialTitle, codigoCarteira: number) {
    return {
      codigoLancamento: t.omieTitleId,
      dataCadastroLancamento: null,
      codigoParcela: t.visionParcelCode ?? 0,
      codigoEmpresa: order.visionCompanyCode ?? 0,
      numeroParcela: t.parcelNumber ?? 0,
      origemParcela: this.conventions.origemParcela,
      valorSaldo: t.openAmount ?? t.amount,
      valorParcela: t.amount,
      numeroDocumento: t.titleNumber ?? "",
      codigoCarteira,
    };
  }
}

