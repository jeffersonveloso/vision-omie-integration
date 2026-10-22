import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/server/infrastructure/database/client";
import {
  customerLinks,
  integrationLogs,
  integrationOrders,
  omieAccounts,
  jobLocks,
  omieDocuments,
  syncCheckpoints,
  syncRuns,
  webhookEvents,
} from "@/server/infrastructure/database/schema";
import type { WebhookEvent, WebhookEventListFilter, WebhookEventRepository, WebhookEventStatus, WebhookEventView } from "../domain/webhook-event";
import { type ErrorCategory, RETURN_STEPS, type StoredError } from "../domain/integration-error";
import { IntegrationOrder, type OrderStatus } from "../domain/integration-order";
import { type DocumentKind, type DocumentStatus, type FinancialTitle, type FiscalInfo, type FiscalReturn, OmieDocument } from "../domain/omie-document";
import type {
  CheckpointRepository,
  CustomerLink,
  CustomerLinkRepository,
  IntegrationLogEntry,
  IntegrationLogRepository,
  IntegrationOrderRepository,
  JobLock,
  SyncRun,
  SyncRunRepository,
} from "../domain/repositories";
import type { VisionOrderPayload } from "../domain/vision-order";

type OrderRow = typeof integrationOrders.$inferSelect;
type DocRow = typeof omieDocuments.$inferSelect;

const returnStepsSql = sql.raw(RETURN_STEPS.map((s) => `'${s}'`).join(","));

function docFromRow(r: DocRow): OmieDocument {
  return OmieDocument.restore({
    id: r.id,
    kind: r.kind as DocumentKind,
    integrationCode: r.integrationCode,
    omieId: r.omieId,
    omieNumber: r.omieNumber,
    status: r.status as DocumentStatus,
    fiscal: (r.fiscal as FiscalInfo | null) ?? null,
    fiscalReturn: (r.fiscalReturn as FiscalReturn) ?? {},
    titles: (r.titles as FinancialTitle[]) ?? [],
    requestPayload: (r.requestPayload as Record<string, unknown> | null) ?? null,
    responsePayload: (r.responsePayload as Record<string, unknown> | null) ?? null,
    sentAt: r.sentAt,
    lastCheckedAt: r.lastCheckedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
}

function orderFromRows(r: OrderRow, docs: DocRow[]): IntegrationOrder {
  return IntegrationOrder.restore({
    id: r.id,
    visionOrderCode: r.visionOrderCode,
    visionCompanyCode: r.visionCompanyCode,
    visionStatusCode: r.visionStatusCode,
    visionStatusDescription: r.visionStatusDescription,
    visionUpdatedAt: r.visionUpdatedAt,
    companyCnpj: r.companyCnpj,
    omieAccountId: r.omieAccountId,
    customerName: r.customerName,
    customerDocument: r.customerDocument,
    totalAmount: r.totalAmount,
    status: r.status as OrderStatus,
    lastError: (r.lastError as StoredError | null) ?? null,
    attempts: r.attempts,
    nextRetryAt: r.nextRetryAt,
    updatedAfterSync: r.updatedAfterSync,
    ignored: r.ignored,
    visionSummary: (r.visionSummary as Record<string, unknown> | null) ?? null,
    visionPayload: (r.visionPayload as VisionOrderPayload | null) ?? null,
    documents: docs.sort((a, b) => a.kind.localeCompare(b.kind)).map(docFromRow),
    firstSeenAt: r.firstSeenAt,
    lastProcessedAt: r.lastProcessedAt,
    lastCheckedAt: r.lastCheckedAt,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
}

export class DrizzleIntegrationOrderRepository implements IntegrationOrderRepository {
  constructor(private readonly db: Database) {}

  private async hydrate(rows: OrderRow[]): Promise<IntegrationOrder[]> {
    if (rows.length === 0) return [];
    const docs = await this.db.select().from(omieDocuments).where(inArray(omieDocuments.orderId, rows.map((r) => r.id)));
    return rows.map((r) => orderFromRows(r, docs.filter((d) => d.orderId === r.id)));
  }

  async findById(id: string): Promise<IntegrationOrder | null> {
    const rows = await this.db.select().from(integrationOrders).where(eq(integrationOrders.id, id)).limit(1);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async findByVisionCodes(codes: number[]): Promise<Map<number, IntegrationOrder>> {
    const result = new Map<number, IntegrationOrder>();
    for (let i = 0; i < codes.length; i += 500) {
      const chunk = codes.slice(i, i + 500);
      const rows = await this.db.select().from(integrationOrders).where(inArray(integrationOrders.visionOrderCode, chunk));
      for (const order of await this.hydrate(rows)) result.set(order.visionOrderCode, order);
    }
    return result;
  }

  async findByOmieDocumentId(omieId: number): Promise<IntegrationOrder | null> {
    const [doc] = await this.db.select({ orderId: omieDocuments.orderId }).from(omieDocuments).where(eq(omieDocuments.omieId, omieId)).limit(1);
    return doc ? this.findById(doc.orderId) : null;
  }

  async save(order: IntegrationOrder): Promise<void> {
    const s = order.toSnapshot();
    const values = {
      id: s.id,
      visionOrderCode: s.visionOrderCode,
      visionCompanyCode: s.visionCompanyCode,
      visionStatusCode: s.visionStatusCode,
      visionStatusDescription: s.visionStatusDescription,
      visionUpdatedAt: s.visionUpdatedAt,
      companyCnpj: s.companyCnpj,
      omieAccountId: s.omieAccountId,
      customerName: s.customerName,
      customerDocument: s.customerDocument,
      totalAmount: s.totalAmount,
      status: s.status,
      lastError: s.lastError,
      errorCategory: s.lastError?.category ?? null,
      attempts: s.attempts,
      nextRetryAt: s.nextRetryAt,
      updatedAfterSync: s.updatedAfterSync,
      ignored: s.ignored,
      visionSummary: s.visionSummary,
      visionPayload: s.visionPayload,
      firstSeenAt: s.firstSeenAt,
      lastProcessedAt: s.lastProcessedAt,
      lastCheckedAt: s.lastCheckedAt,
      completedAt: s.completedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
    const { id: _id, createdAt: _c, firstSeenAt: _f, visionOrderCode: _v, ...update } = values;
    await this.db.transaction(async (tx) => {
      await tx.insert(integrationOrders).values(values).onConflictDoUpdate({ target: integrationOrders.id, set: update });
      for (const doc of s.documents) {
        const d = doc.toSnapshot();
        const docValues = {
          id: d.id,
          orderId: s.id,
          kind: d.kind,
          integrationCode: d.integrationCode,
          omieId: d.omieId,
          omieNumber: d.omieNumber,
          status: d.status,
          fiscal: d.fiscal,
          fiscalReturn: d.fiscalReturn,
          titles: d.titles,
          requestPayload: d.requestPayload,
          responsePayload: d.responsePayload,
          sentAt: d.sentAt,
          lastCheckedAt: d.lastCheckedAt,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        };
        const { id: _di, orderId: _do, kind: _dk, createdAt: _dc, ...docUpdate } = docValues;
        await tx.insert(omieDocuments).values(docValues).onConflictDoUpdate({ target: [omieDocuments.orderId, omieDocuments.kind], set: docUpdate });
      }
    });
  }

  private notProcessing(now: Date) {
    return or(isNull(integrationOrders.processingUntil), lt(integrationOrders.processingUntil, now));
  }

  async listDueForProcessing(now: Date, limit: number, maxAttempts: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: integrationOrders.id })
      .from(integrationOrders)
      .where(
        and(
          eq(integrationOrders.ignored, false),
          this.notProcessing(now),
          or(
            eq(integrationOrders.status, "PENDING"),
            and(
              eq(integrationOrders.status, "ERROR"),
              isNotNull(integrationOrders.nextRetryAt),
              lte(integrationOrders.nextRetryAt, now),
              lt(integrationOrders.attempts, maxAttempts),
              sql`coalesce(${integrationOrders.lastError}->>'step', '') not in (${returnStepsSql})`,
            ),
          ),
        ),
      )
      .orderBy(sql`coalesce(${integrationOrders.nextRetryAt}, ${integrationOrders.firstSeenAt}) asc`)
      .limit(limit);
    return rows.map((r) => r.id);
  }

  async listDueForReconcile(now: Date, since: Date, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: integrationOrders.id })
      .from(integrationOrders)
      .where(
        and(
          eq(integrationOrders.ignored, false),
          this.notProcessing(now),
          gte(integrationOrders.firstSeenAt, since),
          sql`exists (select 1 from ${omieDocuments} d where d.order_id = ${integrationOrders.id} and d.omie_id is not null)`,
          or(
            inArray(integrationOrders.status, ["SENT", "REJECTED", "COMPLETED"]),
            and(
              eq(integrationOrders.status, "ERROR"),
              or(
                sql`coalesce(${integrationOrders.lastError}->>'step', '') not in (${returnStepsSql})`,
                and(isNotNull(integrationOrders.nextRetryAt), lte(integrationOrders.nextRetryAt, now)),
              ),
            ),
          ),
        ),
      )
      .orderBy(sql`${integrationOrders.lastCheckedAt} asc nulls first`)
      .limit(limit);
    return rows.map((r) => r.id);
  }

  async listIdsForBulkRetry(filter: { category?: ErrorCategory; omieAccountId?: string; ids?: string[] }, limit: number): Promise<string[]> {
    const conditions = filter.ids?.length
      ? [inArray(integrationOrders.id, filter.ids)]
      : [
          eq(integrationOrders.status, "ERROR"),
          ...(filter.category ? [eq(integrationOrders.errorCategory, filter.category)] : []),
          ...(filter.omieAccountId ? [eq(integrationOrders.omieAccountId, filter.omieAccountId)] : []),
        ];
    const rows = await this.db.select({ id: integrationOrders.id }).from(integrationOrders).where(and(...conditions)).orderBy(asc(integrationOrders.firstSeenAt)).limit(limit);
    return rows.map((r) => r.id);
  }

  async tryClaim(id: string, until: Date, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(integrationOrders)
      .set({ processingUntil: until })
      .where(and(eq(integrationOrders.id, id), this.notProcessing(now)))
      .returning({ id: integrationOrders.id });
    return rows.length > 0;
  }

  async release(id: string): Promise<void> {
    await this.db.update(integrationOrders).set({ processingUntil: null }).where(eq(integrationOrders.id, id));
  }

  async requestRecheck(id: string): Promise<void> {
    await this.db.update(integrationOrders).set({ lastCheckedAt: null }).where(eq(integrationOrders.id, id));
  }
}

export class DrizzleIntegrationLogRepository implements IntegrationLogRepository {
  constructor(private readonly db: Database) {}

  async append(entries: IntegrationLogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.insert(integrationLogs).values(entries.map((e) => ({ ...e })));
  }

  async purge(input: { before: Date; errorsBefore: Date }): Promise<number> {
    const deleted = await this.db
      .delete(integrationLogs)
      .where(or(and(lt(integrationLogs.createdAt, input.before), sql`${integrationLogs.level} <> 'ERROR'`), lt(integrationLogs.createdAt, input.errorsBefore)))
      .returning({ id: integrationLogs.id });
    return deleted.length;
  }
}

export class DrizzleSyncRunRepository implements SyncRunRepository {
  constructor(private readonly db: Database) {}

  async create(run: SyncRun): Promise<void> {
    await this.db.insert(syncRuns).values({ ...run, stats: run.stats });
  }

  async purgeBefore(date: Date): Promise<number> {
    const deleted = await this.db.delete(syncRuns).where(lt(syncRuns.startedAt, date)).returning({ id: syncRuns.id });
    return deleted.length;
  }

  async update(run: SyncRun): Promise<void> {
    const { id, ...rest } = run;
    await this.db.update(syncRuns).set({ ...rest, stats: run.stats }).where(eq(syncRuns.id, id));
  }
}

export class DrizzleCheckpointRepository implements CheckpointRepository {
  constructor(private readonly db: Database) {}

  async get<T>(key: string): Promise<T | null> {
    const [row] = await this.db.select().from(syncCheckpoints).where(eq(syncCheckpoints.key, key)).limit(1);
    return (row?.value as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.db
      .insert(syncCheckpoints)
      .values({ key, value: value as object, updatedAt: new Date() })
      .onConflictDoUpdate({ target: syncCheckpoints.key, set: { value: value as object, updatedAt: new Date() } });
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(syncCheckpoints).where(eq(syncCheckpoints.key, key));
  }
}

export class DrizzleCustomerLinkRepository implements CustomerLinkRepository {
  constructor(private readonly db: Database) {}

  async find(omieAccountId: string, visionCustomerKey: string): Promise<CustomerLink | null> {
    const [row] = await this.db
      .select()
      .from(customerLinks)
      .where(and(eq(customerLinks.omieAccountId, omieAccountId), eq(customerLinks.visionCustomerKey, visionCustomerKey)))
      .limit(1);
    return row ?? null;
  }

  async save(link: CustomerLink): Promise<void> {
    await this.db
      .insert(customerLinks)
      .values(link)
      .onConflictDoUpdate({
        target: [customerLinks.omieAccountId, customerLinks.visionCustomerKey],
        set: { omieCustomerId: link.omieCustomerId, payloadHash: link.payloadHash, syncedAt: link.syncedAt },
      });
  }
}

/** Trava distribuída simples em tabela (funciona com várias instâncias da aplicação). */
export class DrizzleJobLock implements JobLock {
  constructor(private readonly db: Database) {}

  async tryAcquire(name: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = new Date();
    const until = new Date(now.getTime() + ttlMs);
    await this.db.insert(jobLocks).values({ name, owner: "", lockedUntil: new Date(0) }).onConflictDoNothing();
    const rows = await this.db
      .update(jobLocks)
      .set({ owner, lockedUntil: until })
      .where(and(eq(jobLocks.name, name), lt(jobLocks.lockedUntil, now)))
      .returning({ name: jobLocks.name });
    return rows.length > 0;
  }

  async release(name: string, owner: string): Promise<void> {
    await this.db.update(jobLocks).set({ lockedUntil: new Date(0) }).where(and(eq(jobLocks.name, name), eq(jobLocks.owner, owner)));
  }
}

export class DrizzleWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly db: Database) {}

  private toEvent(row: typeof webhookEvents.$inferSelect): WebhookEvent {
    return { ...row, status: row.status as WebhookEventStatus };
  }

  async insert(event: WebhookEvent): Promise<{ inserted: boolean; id: string }> {
    const inserted = await this.db
      .insert(webhookEvents)
      .values({ ...event, payload: (event.payload ?? {}) as object })
      .onConflictDoNothing({ target: [webhookEvents.source, webhookEvents.messageId] })
      .returning({ id: webhookEvents.id });
    if (inserted.length) return { inserted: true, id: inserted[0].id };
    const [existing] = await this.db
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.source, event.source), eq(webhookEvents.messageId, event.messageId ?? "")))
      .limit(1);
    return { inserted: false, id: existing?.id ?? event.id };
  }

  async findById(id: string): Promise<WebhookEvent | null> {
    const [row] = await this.db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
    return row ? this.toEvent(row) : null;
  }

  async markQueued(ids: string[], at: Date): Promise<void> {
    if (!ids.length) return;
    await this.db
      .update(webhookEvents)
      .set({ status: "QUEUED", enqueuedAt: at })
      .where(and(inArray(webhookEvents.id, ids), inArray(webhookEvents.status, ["RECEIVED", "QUEUED", "FAILED"])));
  }

  async markProcessing(id: string, _at: Date): Promise<void> {
    await this.db.update(webhookEvents).set({ status: "PROCESSING", attempts: sql`${webhookEvents.attempts} + 1` }).where(eq(webhookEvents.id, id));
  }

  async markFinished(id: string, input: { status: "DONE" | "IGNORED"; note: string | null; relatedOrderId: string | null; omieAccountId: string | null }, at: Date): Promise<void> {
    await this.db.update(webhookEvents).set({ ...input, lastError: null, processedAt: at }).where(eq(webhookEvents.id, id));
  }

  async markError(id: string, error: string, final: boolean): Promise<void> {
    await this.db.update(webhookEvents).set({ status: final ? "FAILED" : "QUEUED", lastError: error.slice(0, 2000) }).where(eq(webhookEvents.id, id));
  }

  async listStale(before: Date, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(
        or(
          and(eq(webhookEvents.status, "RECEIVED"), lt(webhookEvents.receivedAt, before)),
          // Na fila há tempo demais: o job pode ter se perdido (Redis reiniciado sem persistência).
          and(eq(webhookEvents.status, "QUEUED"), lt(webhookEvents.enqueuedAt, new Date(before.getTime() - 13 * 60_000))),
        ),
      )
      .orderBy(asc(webhookEvents.receivedAt))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  async listIdsByStatus(status: WebhookEventStatus, limit: number): Promise<string[]> {
    const rows = await this.db.select({ id: webhookEvents.id }).from(webhookEvents).where(eq(webhookEvents.status, status)).orderBy(asc(webhookEvents.receivedAt)).limit(limit);
    return rows.map((r) => r.id);
  }

  async list(filter: WebhookEventListFilter): Promise<{ items: WebhookEventView[]; total: number; counts: Partial<Record<WebhookEventStatus, number>> }> {
    const where = filter.status ? eq(webhookEvents.status, filter.status) : undefined;
    const [rows, [{ total }], grouped] = await Promise.all([
      this.db
        .select({ event: webhookEvents, visionOrderCode: integrationOrders.visionOrderCode, accountName: omieAccounts.name })
        .from(webhookEvents)
        .leftJoin(integrationOrders, eq(integrationOrders.id, webhookEvents.relatedOrderId))
        .leftJoin(omieAccounts, eq(omieAccounts.id, webhookEvents.omieAccountId))
        .where(where)
        .orderBy(sql`${webhookEvents.receivedAt} desc`)
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
      this.db.select({ total: sql<number>`count(*)::int` }).from(webhookEvents).where(where),
      this.db.select({ status: webhookEvents.status, count: sql<number>`count(*)::int` }).from(webhookEvents).groupBy(webhookEvents.status),
    ]);
    return {
      items: rows.map((r) => ({ ...this.toEvent(r.event), visionOrderCode: r.visionOrderCode ?? null, accountName: r.accountName ?? null })),
      total: Number(total),
      counts: Object.fromEntries(grouped.map((g) => [g.status, Number(g.count)])),
    };
  }

  async purgeBefore(date: Date): Promise<number> {
    // Eventos ainda pendentes nunca são apagados pela retenção.
    const deleted = await this.db
      .delete(webhookEvents)
      .where(and(lt(webhookEvents.receivedAt, date), inArray(webhookEvents.status, ["DONE", "IGNORED", "FAILED"])))
      .returning({ id: webhookEvents.id });
    return deleted.length;
  }
}
