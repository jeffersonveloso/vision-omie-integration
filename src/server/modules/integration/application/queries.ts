import type { ErrorCategory, IntegrationStep, StoredError } from "../domain/integration-error";
import type { OrderStatus } from "../domain/integration-order";
import type { DocumentKind, DocumentStatus, FinancialTitle, FiscalInfo, FiscalReturn } from "../domain/omie-document";
import type { LogLevel, SyncRun } from "../domain/repositories";

/** Lado de leitura (CQRS-lite): consultas otimizadas para as telas, sem passar pelos agregados. */

export interface OrderListFilter {
  status?: OrderStatus[];
  omieAccountId?: string;
  errorCategory?: ErrorCategory;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  sort?: "updated_desc" | "updated_asc" | "vision_code_desc" | "vision_updated_desc";
}

export interface OrderListItem {
  id: string;
  visionOrderCode: number;
  visionStatusDescription: string | null;
  visionUpdatedAt: string | null;
  customerName: string | null;
  customerDocument: string | null;
  companyCnpj: string | null;
  omieAccountId: string | null;
  omieAccountName: string | null;
  totalAmount: number | null;
  status: OrderStatus;
  attempts: number;
  nextRetryAt: string | null;
  lastError: Pick<StoredError, "category" | "code" | "message" | "hint" | "step" | "retryable" | "occurredAt"> | null;
  updatedAfterSync: boolean;
  processing: boolean;
  documents: Array<{ kind: DocumentKind; status: DocumentStatus; omieNumber: string | null; invoiceNumber: string | null }>;
  updatedAt: string;
  completedAt: string | null;
}

export interface OrderDetail extends OrderListItem {
  visionCompanyCode: number | null;
  firstSeenAt: string;
  lastProcessedAt: string | null;
  lastCheckedAt: string | null;
  ignored: boolean;
  lastErrorFull: StoredError | null;
  visionPayload: Record<string, unknown> | null;
  visionSummary: Record<string, unknown> | null;
  documentsFull: Array<{
    id: string;
    kind: DocumentKind;
    status: DocumentStatus;
    integrationCode: string;
    omieId: number | null;
    omieNumber: string | null;
    fiscal: FiscalInfo | null;
    fiscalReturn: FiscalReturn;
    titles: FinancialTitle[];
    requestPayload: Record<string, unknown> | null;
    responsePayload: Record<string, unknown> | null;
    sentAt: string | null;
    lastCheckedAt: string | null;
  }>;
}

export interface LogView {
  id: string;
  orderId: string | null;
  runId: string | null;
  level: LogLevel;
  step: IntegrationStep | null;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface DashboardStats {
  totals: Record<OrderStatus, number> & { all: number };
  errorsByCategory: Array<{ category: ErrorCategory; count: number }>;
  byAccount: Array<{ omieAccountId: string | null; name: string | null; total: number; completed: number; errors: number }>;
  last7Days: Array<{ day: string; discovered: number; completed: number; errors: number }>;
  retryScheduled: number;
}

export interface OrderQueryService {
  list(filter: OrderListFilter): Promise<{ items: OrderListItem[]; total: number; counts: Record<string, number> }>;
  detail(id: string): Promise<OrderDetail | null>;
  logs(filter: { orderId?: string; runId?: string; level?: LogLevel; limit?: number }): Promise<LogView[]>;
  stats(): Promise<DashboardStats>;
  runs(limit: number, job?: string): Promise<SyncRun[]>;
  visionFieldPaths(limit: number): Promise<Array<{ path: string; example: unknown; occurrences: number }>>;
}
