import type { ErrorCategory, IntegrationStep } from "./integration-error";
import type { IntegrationOrder, OrderStatus } from "./integration-order";

export interface IntegrationOrderRepository {
  findById(id: string): Promise<IntegrationOrder | null>;
  findByVisionCodes(codes: number[]): Promise<Map<number, IntegrationOrder>>;
  findByOmieDocumentId(omieId: number): Promise<IntegrationOrder | null>;
  save(order: IntegrationOrder): Promise<void>;
  /** Pedidos prontos para envio: na fila, ou com erro cuja nova tentativa automática venceu. */
  listDueForProcessing(now: Date, limit: number, maxAttempts: number): Promise<string[]>;
  /** Pedidos com documentos no Omie que ainda precisam de acompanhamento fiscal/financeiro. */
  listDueForReconcile(now: Date, since: Date, limit: number): Promise<string[]>;
  /** Pedidos com erro filtrados para reenvio em massa. */
  listIdsForBulkRetry(filter: { category?: ErrorCategory; omieAccountId?: string; ids?: string[] }, limit: number): Promise<string[]>;
  /** Trava otimista para não processar o mesmo pedido em paralelo (agendador × reenvio manual). */
  tryClaim(id: string, until: Date, now: Date): Promise<boolean>;
  release(id: string): Promise<void>;
  requestRecheck(id: string): Promise<void>;
}

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface IntegrationLogEntry {
  orderId: string | null;
  runId: string | null;
  level: LogLevel;
  step: IntegrationStep | null;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: Date;
}

export interface IntegrationLogRepository {
  append(entries: IntegrationLogEntry[]): Promise<void>;
}

export type SyncJob = "SYNC" | "RECONCILE" | "RETRY";
export type SyncTrigger = "SCHEDULE" | "MANUAL" | "API";
export type SyncRunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";

export interface SyncRunStats {
  discovered?: number;
  updated?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
  checked?: number;
  returned?: number;
  [key: string]: number | undefined;
}

export interface SyncRun {
  id: string;
  job: SyncJob;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  windowFrom: string | null;
  windowTo: string | null;
  stats: SyncRunStats;
  error: string | null;
}

export interface SyncRunRepository {
  create(run: SyncRun): Promise<void>;
  update(run: SyncRun): Promise<void>;
}

export interface CheckpointRepository {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CustomerLink {
  omieAccountId: string;
  visionCustomerKey: string;
  omieCustomerId: number;
  payloadHash: string;
  syncedAt: Date;
}

export interface CustomerLinkRepository {
  find(omieAccountId: string, visionCustomerKey: string): Promise<CustomerLink | null>;
  save(link: CustomerLink): Promise<void>;
}

export interface JobLock {
  tryAcquire(name: string, owner: string, ttlMs: number): Promise<boolean>;
  release(name: string, owner: string): Promise<void>;
}

export type { OrderStatus };
