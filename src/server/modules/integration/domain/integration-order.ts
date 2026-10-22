import { addMinutes } from "@/server/shared/domain/dates";
import { type IntegrationError, RETURN_STEPS, type StoredError } from "./integration-error";
import { type DocumentKind, OmieDocument } from "./omie-document";
import type { VisionOrderPayload, VisionOrderSnapshot, VisionOrderSummary } from "./vision-order";

export const ORDER_STATUSES = ["PENDING", "ERROR", "SENT", "REJECTED", "COMPLETED", "CANCELLED", "IGNORED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Na fila",
  ERROR: "Com erro",
  SENT: "Aguardando faturamento",
  REJECTED: "NF rejeitada",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  IGNORED: "Ignorado",
};

export interface RetryPolicy {
  maxAutoRetries: number;
  backoffMinutes: number[];
}

export interface IntegrationOrderProps {
  id: string;
  visionOrderCode: number;
  visionCompanyCode: number | null;
  visionStatusCode: number | null;
  visionStatusDescription: string | null;
  visionUpdatedAt: Date | null;
  companyCnpj: string | null;
  omieAccountId: string | null;
  customerName: string | null;
  customerDocument: string | null;
  totalAmount: number | null;
  status: OrderStatus;
  lastError: StoredError | null;
  attempts: number;
  nextRetryAt: Date | null;
  updatedAfterSync: boolean;
  ignored: boolean;
  visionSummary: Record<string, unknown> | null;
  visionPayload: VisionOrderPayload | null;
  documents: OmieDocument[];
  firstSeenAt: Date;
  lastProcessedAt: Date | null;
  /** Última consulta de status fiscal/financeiro no Omie. */
  lastCheckedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SummaryChange = "NEW" | "UNCHANGED" | "REFRESHED" | "UPDATED_AFTER_SYNC";

/**
 * Agregado raiz: o ciclo de vida de UM pedido do Vision dentro da integração.
 * Idempotência: existe no máximo um agregado por código de pedido do Vision,
 * e os documentos Omie usam códigos de integração determinísticos.
 */
export class IntegrationOrder {
  private constructor(private props: IntegrationOrderProps) {}

  static discover(summary: VisionOrderSummary, id: string, now: Date): IntegrationOrder {
    const order = new IntegrationOrder({
      id,
      visionOrderCode: summary.code,
      visionCompanyCode: summary.companyCode,
      visionStatusCode: summary.statusCode,
      visionStatusDescription: summary.statusDescription,
      visionUpdatedAt: summary.updatedAt,
      companyCnpj: null,
      omieAccountId: null,
      customerName: summary.customerName,
      customerDocument: null,
      totalAmount: null,
      status: "PENDING",
      lastError: null,
      attempts: 0,
      nextRetryAt: null,
      updatedAfterSync: false,
      ignored: false,
      visionSummary: summary.raw,
      visionPayload: null,
      documents: [],
      firstSeenAt: now,
      lastProcessedAt: null,
      lastCheckedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return order;
  }

  static restore(props: IntegrationOrderProps): IntegrationOrder {
    return new IntegrationOrder(props);
  }

  get id() { return this.props.id; }
  get visionOrderCode() { return this.props.visionOrderCode; }
  get visionCompanyCode() { return this.props.visionCompanyCode; }
  get visionUpdatedAt() { return this.props.visionUpdatedAt; }
  get companyCnpj() { return this.props.companyCnpj; }
  get omieAccountId() { return this.props.omieAccountId; }
  get status() { return this.props.status; }
  get lastError() { return this.props.lastError; }
  get attempts() { return this.props.attempts; }
  get nextRetryAt() { return this.props.nextRetryAt; }
  get documents() { return this.props.documents; }
  get visionPayload() { return this.props.visionPayload; }
  get ignored() { return this.props.ignored; }
  get updatedAfterSync() { return this.props.updatedAfterSync; }

  document(kind: DocumentKind): OmieDocument | undefined {
    return this.props.documents.find((d) => d.kind === kind);
  }

  hasUnsentDocuments(): boolean {
    return this.props.documents.length === 0 || this.props.documents.some((d) => !d.isSent());
  }

  hasSentDocuments(): boolean {
    return this.props.documents.some((d) => d.isSent());
  }

  /** Atualiza dados vindos da coleta incremental. */
  refreshSummary(summary: VisionOrderSummary, now: Date): SummaryChange {
    const sameVersion = summary.updatedAt && this.props.visionUpdatedAt && summary.updatedAt.getTime() === this.props.visionUpdatedAt.getTime();
    if (sameVersion) return "UNCHANGED";
    const alreadySent = this.hasSentDocuments();
    // Sem data de atualização no resumo não há como saber se mudou: não gera alerta falso.
    if (!summary.updatedAt && alreadySent) return "UNCHANGED";
    this.props = {
      ...this.props,
      visionCompanyCode: summary.companyCode ?? this.props.visionCompanyCode,
      visionStatusCode: summary.statusCode ?? this.props.visionStatusCode,
      visionStatusDescription: summary.statusDescription ?? this.props.visionStatusDescription,
      visionUpdatedAt: summary.updatedAt ?? this.props.visionUpdatedAt,
      customerName: summary.customerName ?? this.props.customerName,
      visionSummary: summary.raw,
      updatedAfterSync: alreadySent ? true : this.props.updatedAfterSync,
      updatedAt: now,
    };
    return alreadySent ? "UPDATED_AFTER_SYNC" : "REFRESHED";
  }

  attachVisionPayload(payload: VisionOrderPayload, snapshot: VisionOrderSnapshot, now: Date): void {
    this.props = {
      ...this.props,
      visionPayload: payload,
      visionCompanyCode: snapshot.companyCode ?? this.props.visionCompanyCode,
      visionStatusCode: snapshot.statusCode ?? this.props.visionStatusCode,
      visionStatusDescription: snapshot.statusDescription ?? this.props.visionStatusDescription,
      visionUpdatedAt: snapshot.updatedAt ?? this.props.visionUpdatedAt,
      customerName: snapshot.customerName ?? this.props.customerName,
      customerDocument: snapshot.customerDocument ?? this.props.customerDocument,
      totalAmount: snapshot.totalAmount,
      updatedAt: now,
    };
  }

  routeTo(omieAccountId: string, companyCnpj: string | null, now: Date): void {
    this.props = { ...this.props, omieAccountId, companyCnpj, updatedAt: now };
  }

  setCompanyCnpj(companyCnpj: string | null, now: Date): void {
    this.props = { ...this.props, companyCnpj, updatedAt: now };
  }

  /** Garante os documentos Omie necessários. Documentos já enviados nunca são recriados. */
  ensureDocuments(kinds: Array<{ kind: DocumentKind; integrationCode: string }>, newId: () => string, now: Date): void {
    const documents = [...this.props.documents];
    for (const { kind, integrationCode } of kinds) {
      if (!documents.some((d) => d.kind === kind)) documents.push(OmieDocument.create(kind, integrationCode, newId(), now));
    }
    this.props = { ...this.props, documents, updatedAt: now };
  }

  recordFailure(error: IntegrationError, policy: RetryPolicy, now: Date): void {
    const attempts = this.props.attempts + 1;
    let nextRetryAt: Date | null = null;
    if (error.retryable && attempts <= policy.maxAutoRetries) {
      const minutes = policy.backoffMinutes[Math.min(attempts - 1, policy.backoffMinutes.length - 1)] ?? 15;
      const waitMinutes = Math.max(minutes, Math.ceil((error.retryAfterMs ?? 0) / 60_000));
      nextRetryAt = addMinutes(now, waitMinutes);
    }
    this.props = { ...this.props, lastError: error.toStored(now), attempts, nextRetryAt, lastProcessedAt: now, updatedAt: now };
    this.recomputeStatus(now);
  }

  /**
   * Registra sucesso de uma etapa. Só limpa o erro se ele pertencer ao mesmo fluxo
   * (envio ou retorno): o sucesso do retorno de um PV não pode apagar a falha de envio da OS.
   */
  recordSuccess(scope: "SEND" | "RETURN", now: Date): void {
    const error = this.props.lastError;
    const errorScope = error?.step && RETURN_STEPS.includes(error.step) ? "RETURN" : "SEND";
    const clears = !error || errorScope === scope;
    this.props = {
      ...this.props,
      lastError: clears ? null : error,
      attempts: clears ? 0 : this.props.attempts,
      nextRetryAt: clears ? null : this.props.nextRetryAt,
      lastProcessedAt: now,
      updatedAt: now,
    };
    this.recomputeStatus(now);
  }

  lastErrorScope(): "SEND" | "RETURN" | null {
    const error = this.props.lastError;
    if (!error) return null;
    return error.step && RETURN_STEPS.includes(error.step) ? "RETURN" : "SEND";
  }

  /** Reenvio manual: limpa o agendamento automático, mantendo o erro visível até o resultado. */
  prepareManualRetry(now: Date): void {
    this.props = { ...this.props, nextRetryAt: null, ignored: false, updatedAt: now };
  }

  markChecked(now: Date): void {
    this.props = { ...this.props, lastCheckedAt: now, updatedAt: now };
  }

  acknowledgeVisionUpdate(now: Date): void {
    this.props = { ...this.props, updatedAfterSync: false, updatedAt: now };
  }

  ignore(now: Date): void {
    this.props = { ...this.props, ignored: true, nextRetryAt: null, updatedAt: now };
    this.recomputeStatus(now);
  }

  unignore(now: Date): void {
    this.props = { ...this.props, ignored: false, updatedAt: now };
    this.recomputeStatus(now);
  }

  /** Status derivado das partes do agregado — fonte única de verdade. */
  recomputeStatus(now: Date): OrderStatus {
    const status = deriveStatus(this.props);
    const completedAt = status === "COMPLETED" ? (this.props.completedAt ?? now) : status === "CANCELLED" ? this.props.completedAt : null;
    this.props = { ...this.props, status, completedAt };
    return status;
  }

  toSnapshot(): IntegrationOrderProps {
    return { ...this.props, documents: [...this.props.documents] };
  }
}

export function deriveStatus(p: Pick<IntegrationOrderProps, "ignored" | "lastError" | "documents">): OrderStatus {
  if (p.ignored) return "IGNORED";
  if (p.lastError) return "ERROR";
  const docs = p.documents;
  if (docs.length === 0 || docs.some((d) => !d.isSent())) return "PENDING";
  if (docs.every((d) => d.status === "CANCELLED") && !docs.some((d) => d.hasPendingReturns())) return "CANCELLED";
  if (docs.some((d) => d.status === "REJECTED")) return "REJECTED";
  const fiscalDone = docs.every((d) => d.status === "AUTHORIZED" || d.status === "CANCELLED");
  const returnsDone = docs.every((d) => d.pendingFiscalReturns().length === 0);
  return fiscalDone && returnsDone ? "COMPLETED" : "SENT";
}
