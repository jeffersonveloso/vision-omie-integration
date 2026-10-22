/**
 * Documento gerado no Omie a partir de um pedido do Vision.
 * Um pedido com produtos gera um Pedido de Venda (NF-e); com serviços, uma Ordem de Serviço (NFS-e);
 * com ambos, os dois documentos.
 */

export const DOCUMENT_KINDS = ["SALES_ORDER", "SERVICE_ORDER"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  SALES_ORDER: "Pedido de Venda",
  SERVICE_ORDER: "Ordem de Serviço",
};

export const DOCUMENT_STATUSES = ["PENDING", "SENT", "AUTHORIZED", "REJECTED", "CANCELLED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type FiscalState = "PENDING" | "AUTHORIZED" | "REJECTED" | "CANCELLED";

/** Situação fiscal normalizada (NF-e via StatusPedido / NFS-e via StatusOS). */
export interface FiscalSnapshot {
  state: FiscalState;
  invoiceNumber: string | null;
  series: string | null;
  accessKey: string | null;
  protocol: string | null;
  rpsNumber: string | null;
  verificationCode: string | null;
  authorizedAt: string | null;
  cancelledAt: string | null;
  rejectionCode: string | null;
  rejectionMessage: string | null;
  pdfUrl: string | null;
  xml: string | null;
  omieStage: string | null;
}

export type FiscalInfo = Omit<FiscalSnapshot, "xml"> & { hasXml: boolean; checkedAt: string };

export interface ReturnMark {
  sentAt: string;
  /** Assinatura do evento retornado (ex.: chave da NF), para detectar mudanças e evitar reenvio. */
  signature: string;
}

export interface FiscalReturn {
  authorization?: ReturnMark;
  rejection?: ReturnMark;
  cancellation?: ReturnMark;
}

export type FiscalReturnKind = keyof FiscalReturn;

export interface FinancialPayment {
  omieBaixaId: number;
  paidAt: string | null;
  amount: number;
  interest: number;
  discount: number;
  fine: number;
  bankAccountId: number | null;
  returnedAt: string | null;
  visionBaixaCode: number | null;
  cancelledAt: string | null;
  cancellationReturnedAt: string | null;
}

export interface FinancialTitle {
  omieTitleId: number;
  titleNumber: string | null;
  parcelLabel: string | null;
  parcelNumber: number | null;
  amount: number;
  openAmount: number | null;
  dueDate: string | null;
  status: string | null;
  visionParcelCode: number | null;
  payments: FinancialPayment[];
}

/** Snapshot financeiro vindo do Omie (MovimentosFinanceiros › ListarMovimentos). */
export interface FinancialTitleSnapshot {
  omieTitleId: number;
  titleNumber: string | null;
  parcelLabel: string | null;
  parcelNumber: number | null;
  amount: number;
  openAmount: number | null;
  dueDate: string | null;
  status: string | null;
  createdAt: string | null;
  payments: Array<Omit<FinancialPayment, "returnedAt" | "visionBaixaCode" | "cancelledAt" | "cancellationReturnedAt">>;
}

export interface OmieDocumentProps {
  id: string;
  kind: DocumentKind;
  integrationCode: string;
  omieId: number | null;
  omieNumber: string | null;
  status: DocumentStatus;
  fiscal: FiscalInfo | null;
  fiscalReturn: FiscalReturn;
  titles: FinancialTitle[];
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  sentAt: Date | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class OmieDocument {
  private constructor(private props: OmieDocumentProps) {}

  static create(kind: DocumentKind, integrationCode: string, id: string, now: Date): OmieDocument {
    return new OmieDocument({
      id,
      kind,
      integrationCode,
      omieId: null,
      omieNumber: null,
      status: "PENDING",
      fiscal: null,
      fiscalReturn: {},
      titles: [],
      requestPayload: null,
      responsePayload: null,
      sentAt: null,
      lastCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: OmieDocumentProps): OmieDocument {
    return new OmieDocument(props);
  }

  get id() { return this.props.id; }
  get kind() { return this.props.kind; }
  get integrationCode() { return this.props.integrationCode; }
  get omieId() { return this.props.omieId; }
  get omieNumber() { return this.props.omieNumber; }
  get status() { return this.props.status; }
  get fiscal() { return this.props.fiscal; }
  get fiscalReturn() { return this.props.fiscalReturn; }
  get titles() { return this.props.titles; }

  isSent(): boolean {
    return this.props.status !== "PENDING" && this.props.omieId !== null;
  }

  recordRequest(payload: Record<string, unknown>, now: Date): void {
    this.props = { ...this.props, requestPayload: payload, updatedAt: now };
  }

  markSent(omieId: number, omieNumber: string | null, response: Record<string, unknown> | null, now: Date): void {
    this.props = { ...this.props, omieId, omieNumber, status: "SENT", responsePayload: response, sentAt: this.props.sentAt ?? now, updatedAt: now };
  }

  /** Aplica a situação fiscal consultada no Omie. Retorna true se o estado mudou. */
  applyFiscal(snapshot: FiscalSnapshot, now: Date): boolean {
    const previous = this.props.status;
    const { xml, ...rest } = snapshot;
    const fiscal: FiscalInfo = { ...rest, hasXml: Boolean(xml), checkedAt: now.toISOString() };
    const status: DocumentStatus = snapshot.state === "PENDING" ? (previous === "PENDING" ? "PENDING" : "SENT") : snapshot.state;
    this.props = { ...this.props, fiscal, status, lastCheckedAt: now, updatedAt: now };
    return previous !== status;
  }

  /** Retornos fiscais ainda não enviados ao Vision, na ordem correta (autorização antes de cancelamento). */
  pendingFiscalReturns(): Array<{ kind: FiscalReturnKind; signature: string }> {
    const f = this.props.fiscal;
    const r = this.props.fiscalReturn;
    if (!f) return [];
    const pending: Array<{ kind: FiscalReturnKind; signature: string }> = [];
    const authSignature = f.accessKey ?? f.invoiceNumber ?? f.verificationCode ?? "";
    if ((this.props.status === "AUTHORIZED" || this.props.status === "CANCELLED") && authSignature && r.authorization?.signature !== authSignature) {
      pending.push({ kind: "authorization", signature: authSignature });
    }
    if (this.props.status === "REJECTED") {
      const signature = `${f.rejectionCode ?? ""}|${f.rejectionMessage ?? ""}`;
      if (r.rejection?.signature !== signature) pending.push({ kind: "rejection", signature });
    }
    if (this.props.status === "CANCELLED") {
      const signature = f.cancelledAt ?? authSignature ?? "cancelada";
      if (!r.cancellation) pending.push({ kind: "cancellation", signature });
    }
    return pending;
  }

  hasPendingReturns(): boolean {
    return this.pendingFiscalReturns().length > 0 || this.pendingPaymentReturns().length > 0 || this.pendingPaymentCancellations().length > 0;
  }

  markFiscalReturned(kind: FiscalReturnKind, signature: string, now: Date): void {
    this.props = { ...this.props, fiscalReturn: { ...this.props.fiscalReturn, [kind]: { sentAt: now.toISOString(), signature } }, updatedAt: now };
  }

  /**
   * Mescla os títulos do Omie preservando o vínculo com as parcelas do Vision e o que já foi retornado.
   * Baixas que desaparecem do Omie após terem sido retornadas viram "cancelamento de baixa".
   */
  syncTitles(snapshots: FinancialTitleSnapshot[], now: Date): void {
    const byId = new Map(this.props.titles.map((t) => [t.omieTitleId, t]));
    const merged: FinancialTitle[] = snapshots.map((s) => {
      const existing = byId.get(s.omieTitleId);
      const knownPayments = new Map((existing?.payments ?? []).map((p) => [p.omieBaixaId, p]));
      const currentIds = new Set(s.payments.map((p) => p.omieBaixaId));
      const payments: FinancialPayment[] = s.payments.map((p) => {
        const known = knownPayments.get(p.omieBaixaId);
        return {
          ...p,
          returnedAt: known?.returnedAt ?? null,
          visionBaixaCode: known?.visionBaixaCode ?? null,
          cancelledAt: null,
          cancellationReturnedAt: known?.cancellationReturnedAt ?? null,
        };
      });
      for (const known of existing?.payments ?? []) {
        if (!currentIds.has(known.omieBaixaId)) {
          payments.push({ ...known, cancelledAt: known.cancelledAt ?? now.toISOString() });
        }
      }
      return {
        omieTitleId: s.omieTitleId,
        titleNumber: s.titleNumber,
        parcelLabel: s.parcelLabel,
        parcelNumber: s.parcelNumber,
        amount: s.amount,
        openAmount: s.openAmount,
        dueDate: s.dueDate,
        status: s.status,
        visionParcelCode: existing?.visionParcelCode ?? null,
        payments,
      };
    });
    this.props = { ...this.props, titles: merged, updatedAt: now };
  }

  linkTitleToVisionParcel(omieTitleId: number, visionParcelCode: number | null, now: Date): void {
    this.props = {
      ...this.props,
      titles: this.props.titles.map((t) => (t.omieTitleId === omieTitleId ? { ...t, visionParcelCode } : t)),
      updatedAt: now,
    };
  }

  pendingPaymentReturns(): Array<{ title: FinancialTitle; payment: FinancialPayment }> {
    return this.props.titles.flatMap((title) =>
      title.payments.filter((p) => !p.returnedAt && !p.cancelledAt && p.paidAt).map((payment) => ({ title, payment })),
    );
  }

  pendingPaymentCancellations(): Array<{ title: FinancialTitle; payment: FinancialPayment }> {
    return this.props.titles.flatMap((title) =>
      title.payments.filter((p) => p.cancelledAt && p.returnedAt && !p.cancellationReturnedAt).map((payment) => ({ title, payment })),
    );
  }

  markPaymentReturned(omieBaixaId: number, visionBaixaCode: number | null, now: Date): void {
    this.updatePayment(omieBaixaId, (p) => ({ ...p, returnedAt: now.toISOString(), visionBaixaCode }), now);
  }

  markPaymentCancellationReturned(omieBaixaId: number, now: Date): void {
    this.updatePayment(omieBaixaId, (p) => ({ ...p, cancellationReturnedAt: now.toISOString() }), now);
  }

  private updatePayment(omieBaixaId: number, fn: (p: FinancialPayment) => FinancialPayment, now: Date): void {
    this.props = {
      ...this.props,
      titles: this.props.titles.map((t) => ({ ...t, payments: t.payments.map((p) => (p.omieBaixaId === omieBaixaId ? fn(p) : p)) })),
      updatedAt: now,
    };
  }

  touchChecked(now: Date): void {
    this.props = { ...this.props, lastCheckedAt: now, updatedAt: now };
  }

  toSnapshot(): OmieDocumentProps {
    return { ...this.props };
  }
}
