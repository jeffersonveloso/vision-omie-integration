import type { Clock } from "@/server/shared/application/ports";
import { addMinutes } from "@/server/shared/domain/dates";
import type { OmieAccountRepository } from "@/server/modules/omie-accounts/domain/omie-account-repository";
import type { ValueMapEntryRepository } from "@/server/modules/mappings/domain/repositories";
import type { IntegrationSettings, SettingsRepository } from "@/server/modules/settings/domain/integration-settings";
import { IntegrationError } from "../../domain/integration-error";
import type { IntegrationOrder } from "../../domain/integration-order";
import { DOCUMENT_KIND_LABELS, type FiscalSnapshot, type OmieDocument } from "../../domain/omie-document";
import { matchTitlesToVisionParcels } from "../../domain/parcel-matching";
import type { IntegrationLogRepository, IntegrationOrderRepository } from "../../domain/repositories";
import { snapshotVisionOrder } from "../../domain/vision-order";
import { ExecutionLog } from "../execution-log";
import type { DocumentDownloader, OmieGatewayFactory, VisionGateway } from "../ports";
import { VisionReturnBuilder } from "../vision-return-builder";

export type ReconcileOutcome =
  | { status: "OK"; orderId: string; returned: number; changed: boolean }
  | { status: "FAILED"; orderId: string; error: IntegrationError }
  | { status: "SKIPPED"; orderId: string; reason: string };

export interface ReconcileOrderDeps {
  orders: IntegrationOrderRepository;
  accounts: OmieAccountRepository;
  entries: ValueMapEntryRepository;
  omie: OmieGatewayFactory;
  vision: VisionGateway;
  downloader: DocumentDownloader;
  settings: SettingsRepository;
  logs: IntegrationLogRepository;
  clock: Clock;
  timeZone: string;
}

/**
 * Etapas 7–8 do fluxo (Omie → Vision): acompanha NF-e/NFS-e e títulos no Omie e devolve ao Vision
 * autorização, rejeição, cancelamento, baixas e cancelamentos de baixa — cada evento uma única vez.
 */
export class ReconcileOrder {
  constructor(private readonly deps: ReconcileOrderDeps) {}

  async execute(input: { orderId: string; runId: string | null }): Promise<ReconcileOutcome> {
    const { orders, clock, logs } = this.deps;
    const now = clock.now();
    if (!(await orders.tryClaim(input.orderId, addMinutes(now, 5), now))) {
      return { status: "SKIPPED", orderId: input.orderId, reason: "Pedido já está sendo processado." };
    }
    const log = new ExecutionLog({ orderId: input.orderId, runId: input.runId }, clock);
    try {
      const order = await orders.findById(input.orderId);
      if (!order) return { status: "SKIPPED", orderId: input.orderId, reason: "Pedido não encontrado." };
      if (order.ignored || !order.hasSentDocuments()) return { status: "SKIPPED", orderId: input.orderId, reason: "Sem documentos no Omie." };
      const statusBefore = order.status;
      try {
        const returned = await this.run(order, log);
        order.markChecked(clock.now());
        order.recordSuccess("RETURN", clock.now());
        await orders.save(order);
        return { status: "OK", orderId: order.id, returned, changed: statusBefore !== order.status };
      } catch (raw) {
        const error = IntegrationError.from(raw, log.currentStep ?? "CHECK_FISCAL");
        const settings = await this.deps.settings.get();
        order.markChecked(clock.now());
        order.recordFailure(error, settings.retry, clock.now());
        await orders.save(order);
        log.add("ERROR", error.message, { category: error.category, code: error.code, hint: error.hint, retryable: error.retryable, details: error.details }, error.step);
        return { status: "FAILED", orderId: order.id, error };
      }
    } finally {
      await log.flush(logs);
      await orders.release(input.orderId);
    }
  }

  private async run(order: IntegrationOrder, log: ExecutionLog): Promise<number> {
    const { accounts, omie, vision, clock, timeZone } = this.deps;
    const settings = await this.deps.settings.get();
    const account = order.omieAccountId ? await accounts.findById(order.omieAccountId) : null;
    if (!account) {
      throw new IntegrationError({ category: "ROUTING", code: "ACCOUNT_MISSING", message: "A conta Omie deste pedido não existe mais.", hint: "Recadastre a conta Omie com o mesmo CNPJ.", step: "CHECK_FISCAL" });
    }
    const gateway = omie.forAccount(account.credentials(), log.recorder());
    const builder = new VisionReturnBuilder(settings.visionReturn);
    const parcels = order.visionPayload ? snapshotVisionOrder(order.visionPayload).parcels : [];
    let returned = 0;

    for (const doc of order.documents.filter((d) => d.isSent())) {
      const label = DOCUMENT_KIND_LABELS[doc.kind];
      if (this.isSettled(doc)) continue;

      // 7. Situação fiscal
      log.step("CHECK_FISCAL");
      const fiscal = doc.kind === "SALES_ORDER" ? await gateway.getSalesOrderFiscal(doc.omieId!) : await gateway.getServiceOrderFiscal(doc.omieId!);
      const previous = doc.status;
      if (doc.applyFiscal(fiscal, clock.now())) log.info(this.describeFiscal(label, previous, fiscal));

      // Títulos (gerados no faturamento)
      if (settings.reconcile.returnFinancial && (doc.status === "AUTHORIZED" || doc.status === "CANCELLED")) {
        log.step("CHECK_FINANCIAL");
        const titles = await gateway.listFinancialTitles(doc.omieId!);
        doc.syncTitles(titles, clock.now());
        const links = matchTitlesToVisionParcels(doc.titles, parcels, timeZone);
        for (const [titleId, parcelCode] of links) doc.linkTitleToVisionParcel(titleId, parcelCode, clock.now());
      }

      // 8. Retornos fiscais ao Vision
      returned += await this.returnFiscal(order, doc, fiscal, builder, settings, log, vision);

      // Retornos financeiros ao Vision
      if (settings.reconcile.returnFinancial) returned += await this.returnFinancial(order, doc, builder, settings, log, vision);
    }
    return returned;
  }

  private async returnFiscal(
    order: IntegrationOrder,
    doc: OmieDocument,
    fiscal: FiscalSnapshot,
    builder: VisionReturnBuilder,
    settings: IntegrationSettings,
    log: ExecutionLog,
    vision: VisionGateway,
  ): Promise<number> {
    const { clock } = this.deps;
    let count = 0;
    for (const pending of doc.pendingFiscalReturns()) {
      log.step("RETURN_FISCAL");
      if (pending.kind === "authorization") {
        const attachments = await this.attachments(fiscal, settings, log);
        await vision.sendInvoiceAuthorization(builder.authorization(order, doc, fiscal, attachments, clock.now()), log.recorder());
        log.info(`Autorização da nota ${fiscal.invoiceNumber ?? ""} informada ao Vision.`);
      } else if (pending.kind === "rejection") {
        await vision.sendInvoiceRejection(builder.rejection(order, doc), log.recorder());
        log.warn(`Rejeição da nota informada ao Vision: ${doc.fiscal?.rejectionMessage ?? "sem descrição"}.`);
      } else {
        const attachments = await this.attachments(fiscal, settings, log);
        await vision.sendInvoiceCancellation(builder.cancellation(order, doc, { pdfBase64: attachments.pdfBase64, xmlBase64: attachments.xmlBase64 }), log.recorder());
        log.warn("Cancelamento da nota informado ao Vision.");
      }
      doc.markFiscalReturned(pending.kind, pending.signature, clock.now());
      await this.deps.orders.save(order);
      count++;
    }
    return count;
  }

  private async returnFinancial(
    order: IntegrationOrder,
    doc: OmieDocument,
    builder: VisionReturnBuilder,
    settings: IntegrationSettings,
    log: ExecutionLog,
    vision: VisionGateway,
  ): Promise<number> {
    const { clock } = this.deps;
    let count = 0;
    for (const { title, payment } of doc.pendingPaymentReturns()) {
      log.step("RETURN_FINANCIAL");
      if (!title.visionParcelCode) {
        throw new IntegrationError({
          category: "VALIDATION",
          code: "PARCEL_NOT_LINKED",
          message: `A baixa do título ${title.titleNumber ?? title.omieTitleId} (parcela ${title.parcelLabel ?? "-"}) não pôde ser vinculada a uma parcela do pedido no Vision.`,
          hint: "As parcelas do Omie não correspondem às do Vision (quantidade ou vencimentos diferentes). Ajuste as parcelas e reenvie.",
          step: "RETURN_FINANCIAL",
          details: { titulo: title },
        });
      }
      const bankAccount = await this.visionBankAccount(order, payment.bankAccountId, settings);
      const response = await vision.sendParcelPayment(builder.payment(order, title, payment, bankAccount), log.recorder());
      doc.markPaymentReturned(payment.omieBaixaId, extractCode(response), clock.now());
      await this.deps.orders.save(order);
      log.info(`Baixa de R$ ${payment.amount.toFixed(2)} da parcela ${title.parcelLabel ?? title.parcelNumber ?? ""} informada ao Vision.`);
      count++;
    }
    for (const { payment } of doc.pendingPaymentCancellations()) {
      log.step("RETURN_FINANCIAL");
      await vision.cancelParcelPayment(builder.paymentCancellation(order, payment), log.recorder());
      doc.markPaymentCancellationReturned(payment.omieBaixaId, clock.now());
      await this.deps.orders.save(order);
      log.warn(`Cancelamento da baixa ${payment.omieBaixaId} informado ao Vision.`);
      count++;
    }
    return count;
  }

  private async visionBankAccount(order: IntegrationOrder, omieBankAccountId: number | null, settings: IntegrationSettings): Promise<number> {
    if (omieBankAccountId !== null && order.omieAccountId) {
      const entries = await this.deps.entries.listByAccount(order.omieAccountId);
      const match = entries.find((e) => e.valueMapKey === settings.visionReturn.contaCorrenteMapKey && e.omieValue === String(omieBankAccountId));
      if (match) return Number(match.visionValue) || 0;
    }
    if (settings.visionReturn.defaultCodigoContaCorrente !== null) return settings.visionReturn.defaultCodigoContaCorrente;
    throw new IntegrationError({
      category: "MAPPING",
      code: "BANK_ACCOUNT_NOT_MAPPED",
      message: `A conta corrente ${omieBankAccountId ?? "-"} do Omie usada na baixa não tem correspondente no Vision.`,
      hint: "Cadastre a conta em Mapeamentos › Tabelas de-para › Conta corrente (retorno de baixas) ou defina a conta padrão em Configurações.",
      step: "RETURN_FINANCIAL",
    });
  }

  private async attachments(fiscal: FiscalSnapshot, settings: IntegrationSettings, log: ExecutionLog): Promise<{ pdfBase64?: string; xmlBase64?: string }> {
    const out: { pdfBase64?: string; xmlBase64?: string } = {};
    if (settings.reconcile.attachXml && fiscal.xml) out.xmlBase64 = Buffer.from(fiscal.xml, "utf8").toString("base64");
    if (settings.reconcile.attachPdf && fiscal.pdfUrl) {
      const pdf = await this.deps.downloader.download(fiscal.pdfUrl).catch(() => null);
      if (pdf) out.pdfBase64 = pdf.toString("base64");
      else log.warn("Não foi possível baixar o PDF da nota; o retorno seguiu sem o anexo.");
    }
    return out;
  }

  /** Documentos encerrados não consomem mais chamadas à API do Omie. */
  private isSettled(doc: OmieDocument): boolean {
    if (doc.hasPendingReturns()) return false;
    if (doc.status === "CANCELLED") return Boolean(doc.fiscalReturn.cancellation);
    if (doc.status === "AUTHORIZED" && doc.fiscalReturn.authorization && doc.titles.length > 0) {
      return doc.titles.every((t) => (t.openAmount ?? t.amount) <= 0.005 && t.payments.every((p) => p.returnedAt || p.cancelledAt));
    }
    return false;
  }

  private describeFiscal(label: string, previous: string, fiscal: FiscalSnapshot): string {
    switch (fiscal.state) {
      case "AUTHORIZED":
        return `${label}: nota ${fiscal.invoiceNumber ?? ""} autorizada${fiscal.accessKey ? ` (chave ${fiscal.accessKey})` : ""}.`;
      case "REJECTED":
        return `${label}: nota rejeitada — ${fiscal.rejectionCode ? `${fiscal.rejectionCode} ` : ""}${fiscal.rejectionMessage ?? "sem descrição"}.`;
      case "CANCELLED":
        return `${label}: documento cancelado no Omie.`;
      default:
        return `${label}: aguardando faturamento (situação anterior: ${previous}).`;
    }
  }
}

function extractCode(response: unknown): number | null {
  if (typeof response === "number") return response;
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>;
    const value = r.codigoBaixa ?? r.codigo ?? r.id;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}
