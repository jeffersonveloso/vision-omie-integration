import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/server/infrastructure/database/client";
import { integrationLogs, integrationOrders, omieAccounts, omieDocuments, syncRuns } from "@/server/infrastructure/database/schema";
import { toIsoDate } from "@/server/shared/domain/dates";
import { collectLeafPaths } from "@/server/modules/mappings/domain/object-path";
import type { DashboardStats, LogView, OrderDetail, OrderListFilter, OrderListItem, OrderQueryService } from "../application/queries";
import type { ErrorCategory, IntegrationStep, StoredError } from "../domain/integration-error";
import { ORDER_STATUSES, type OrderStatus } from "../domain/integration-order";
import type { DocumentKind, DocumentStatus, FinancialTitle, FiscalInfo, FiscalReturn } from "../domain/omie-document";
import type { LogLevel, SyncRun, SyncRunStatus, SyncTrigger } from "../domain/repositories";

type OrderRow = typeof integrationOrders.$inferSelect;
type DocRow = typeof omieDocuments.$inferSelect;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export class DrizzleOrderQueryService implements OrderQueryService {
  constructor(
    private readonly db: Database,
    private readonly timeZone = "America/Sao_Paulo",
  ) {}

  /** Dia (yyyy-MM-dd) no fuso da operação, para os gráficos baterem com o calendário do usuário. */
  private day(column: SQL | typeof integrationOrders.firstSeenAt) {
    return sql<string>`to_char(${column} at time zone ${this.timeZone}, 'YYYY-MM-DD')`;
  }

  private filters(filter: Omit<OrderListFilter, "page" | "pageSize" | "status">): SQL[] {
    const conditions: SQL[] = [];
    if (filter.omieAccountId) conditions.push(eq(integrationOrders.omieAccountId, filter.omieAccountId));
    if (filter.errorCategory) conditions.push(eq(integrationOrders.errorCategory, filter.errorCategory));
    if (filter.from) conditions.push(gte(integrationOrders.firstSeenAt, new Date(`${filter.from}T00:00:00`)));
    if (filter.to) conditions.push(lte(integrationOrders.firstSeenAt, new Date(`${filter.to}T23:59:59`)));
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim()}%`;
      const digits = filter.search.replace(/\D/g, "");
      conditions.push(
        or(
          ilike(sql`${integrationOrders.visionOrderCode}::text`, term),
          ilike(integrationOrders.customerName, term),
          ilike(integrationOrders.customerDocument, digits ? `%${digits}%` : term),
          ilike(integrationOrders.companyCnpj, digits ? `%${digits}%` : term),
          sql`exists (select 1 from ${omieDocuments} d where d.order_id = ${integrationOrders.id} and (d.omie_number ilike ${term} or d.fiscal->>'invoiceNumber' ilike ${term}))`,
        )!,
      );
    }
    return conditions;
  }

  async list(filter: OrderListFilter): Promise<{ items: OrderListItem[]; total: number; counts: Record<string, number> }> {
    const base = this.filters(filter);
    const where = and(...base, ...(filter.status?.length ? [inArray(integrationOrders.status, filter.status)] : []));
    const order = {
      updated_desc: [desc(integrationOrders.updatedAt)],
      updated_asc: [asc(integrationOrders.updatedAt)],
      vision_code_desc: [desc(integrationOrders.visionOrderCode)],
      vision_updated_desc: [sql`${integrationOrders.visionUpdatedAt} desc nulls last`],
    }[filter.sort ?? "updated_desc"];

    const [rows, totalRow, countRows] = await Promise.all([
      this.db
        .select({ order: integrationOrders, accountName: omieAccounts.name })
        .from(integrationOrders)
        .leftJoin(omieAccounts, eq(omieAccounts.id, integrationOrders.omieAccountId))
        .where(where)
        .orderBy(...order)
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
      this.db.select({ count: sql<number>`count(*)::int` }).from(integrationOrders).where(where),
      this.db
        .select({ status: integrationOrders.status, count: sql<number>`count(*)::int` })
        .from(integrationOrders)
        .where(base.length ? and(...base) : undefined)
        .groupBy(integrationOrders.status),
    ]);

    const docs = rows.length ? await this.db.select().from(omieDocuments).where(inArray(omieDocuments.orderId, rows.map((r) => r.order.id))) : [];
    const counts: Record<string, number> = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
    for (const c of countRows) counts[c.status] = Number(c.count);
    counts.ALL = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      items: rows.map((r) => this.toListItem(r.order, r.accountName, docs.filter((d) => d.orderId === r.order.id))),
      total: Number(totalRow[0]?.count ?? 0),
      counts,
    };
  }

  private toListItem(o: OrderRow, accountName: string | null, docs: DocRow[]): OrderListItem {
    const error = o.lastError as StoredError | null;
    return {
      id: o.id,
      visionOrderCode: o.visionOrderCode,
      visionStatusDescription: o.visionStatusDescription,
      visionUpdatedAt: iso(o.visionUpdatedAt),
      customerName: o.customerName,
      customerDocument: o.customerDocument,
      companyCnpj: o.companyCnpj,
      omieAccountId: o.omieAccountId,
      omieAccountName: accountName,
      totalAmount: o.totalAmount,
      status: o.status as OrderStatus,
      attempts: o.attempts,
      nextRetryAt: iso(o.nextRetryAt),
      lastError: error ? { category: error.category, code: error.code, message: error.message, hint: error.hint, step: error.step, retryable: error.retryable, occurredAt: error.occurredAt } : null,
      updatedAfterSync: o.updatedAfterSync,
      processing: Boolean(o.processingUntil && o.processingUntil > new Date()),
      documents: docs
        .sort((a, b) => a.kind.localeCompare(b.kind))
        .map((d) => ({ kind: d.kind as DocumentKind, status: d.status as DocumentStatus, omieNumber: d.omieNumber, invoiceNumber: (d.fiscal as FiscalInfo | null)?.invoiceNumber ?? null })),
      updatedAt: o.updatedAt.toISOString(),
      completedAt: iso(o.completedAt),
    };
  }

  async detail(id: string): Promise<OrderDetail | null> {
    const [row] = await this.db
      .select({ order: integrationOrders, accountName: omieAccounts.name })
      .from(integrationOrders)
      .leftJoin(omieAccounts, eq(omieAccounts.id, integrationOrders.omieAccountId))
      .where(eq(integrationOrders.id, id))
      .limit(1);
    if (!row) return null;
    const docs = await this.db.select().from(omieDocuments).where(eq(omieDocuments.orderId, id));
    const o = row.order;
    return {
      ...this.toListItem(o, row.accountName, docs),
      visionCompanyCode: o.visionCompanyCode,
      firstSeenAt: o.firstSeenAt.toISOString(),
      lastProcessedAt: iso(o.lastProcessedAt),
      lastCheckedAt: iso(o.lastCheckedAt),
      ignored: o.ignored,
      lastErrorFull: (o.lastError as StoredError | null) ?? null,
      visionPayload: (o.visionPayload as Record<string, unknown> | null) ?? null,
      visionSummary: (o.visionSummary as Record<string, unknown> | null) ?? null,
      documentsFull: docs
        .sort((a, b) => a.kind.localeCompare(b.kind))
        .map((d) => ({
          id: d.id,
          kind: d.kind as DocumentKind,
          status: d.status as DocumentStatus,
          integrationCode: d.integrationCode,
          omieId: d.omieId,
          omieNumber: d.omieNumber,
          fiscal: (d.fiscal as FiscalInfo | null) ?? null,
          fiscalReturn: (d.fiscalReturn as FiscalReturn) ?? {},
          titles: (d.titles as FinancialTitle[]) ?? [],
          requestPayload: (d.requestPayload as Record<string, unknown> | null) ?? null,
          responsePayload: (d.responsePayload as Record<string, unknown> | null) ?? null,
          sentAt: iso(d.sentAt),
          lastCheckedAt: iso(d.lastCheckedAt),
        })),
    };
  }

  async logs(filter: { orderId?: string; runId?: string; level?: LogLevel; limit?: number }): Promise<LogView[]> {
    const conditions: SQL[] = [];
    if (filter.orderId) conditions.push(eq(integrationLogs.orderId, filter.orderId));
    if (filter.runId) conditions.push(eq(integrationLogs.runId, filter.runId));
    if (filter.level) conditions.push(eq(integrationLogs.level, filter.level));
    const rows = await this.db
      .select()
      .from(integrationLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(integrationLogs.createdAt), desc(integrationLogs.id))
      .limit(Math.min(filter.limit ?? 300, 2000));
    return rows.map((r) => ({
      id: String(r.id),
      orderId: r.orderId,
      runId: r.runId,
      level: r.level as LogLevel,
      step: r.step as IntegrationStep | null,
      message: r.message,
      data: (r.data as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async stats(): Promise<DashboardStats> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [statusRows, categoryRows, accountRows, discoveredRows, completedRows, errorRows, retryRow] = await Promise.all([
      this.db.select({ status: integrationOrders.status, count: sql<number>`count(*)::int` }).from(integrationOrders).groupBy(integrationOrders.status),
      this.db
        .select({ category: integrationOrders.errorCategory, count: sql<number>`count(*)::int` })
        .from(integrationOrders)
        .where(and(eq(integrationOrders.status, "ERROR"), isNotNull(integrationOrders.errorCategory)))
        .groupBy(integrationOrders.errorCategory),
      this.db
        .select({
          omieAccountId: integrationOrders.omieAccountId,
          name: omieAccounts.name,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${integrationOrders.status} = 'COMPLETED')::int`,
          errors: sql<number>`count(*) filter (where ${integrationOrders.status} = 'ERROR')::int`,
        })
        .from(integrationOrders)
        .leftJoin(omieAccounts, eq(omieAccounts.id, integrationOrders.omieAccountId))
        .groupBy(integrationOrders.omieAccountId, omieAccounts.name),
      this.db
        .select({ day: this.day(integrationOrders.firstSeenAt), count: sql<number>`count(*)::int` })
        .from(integrationOrders)
        .where(gte(integrationOrders.firstSeenAt, since))
        .groupBy(sql`1`),
      this.db
        .select({ day: this.day(sql`${integrationOrders.completedAt}`), count: sql<number>`count(*)::int` })
        .from(integrationOrders)
        .where(and(gte(integrationOrders.completedAt, since), eq(integrationOrders.status, "COMPLETED")))
        .groupBy(sql`1`),
      this.db
        .select({ day: this.day(sql`${integrationLogs.createdAt}`), count: sql<number>`count(distinct ${integrationLogs.orderId})::int` })
        .from(integrationLogs)
        .where(and(gte(integrationLogs.createdAt, since), eq(integrationLogs.level, "ERROR"), isNotNull(integrationLogs.orderId)))
        .groupBy(sql`1`),
      this.db.select({ count: sql<number>`count(*)::int` }).from(integrationOrders).where(and(eq(integrationOrders.status, "ERROR"), isNotNull(integrationOrders.nextRetryAt))),
    ]);

    const totals = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number> & { all: number };
    for (const r of statusRows) totals[r.status as OrderStatus] = Number(r.count);
    totals.all = ORDER_STATUSES.reduce((a, s) => a + totals[s], 0);

    const days: DashboardStats["last7Days"] = [];
    for (let i = 6; i >= 0; i--) {
      const day = toIsoDate(new Date(Date.now() - i * 86_400_000), this.timeZone);
      days.push({
        day,
        discovered: Number(discoveredRows.find((r) => r.day === day)?.count ?? 0),
        completed: Number(completedRows.find((r) => r.day === day)?.count ?? 0),
        errors: Number(errorRows.find((r) => r.day === day)?.count ?? 0),
      });
    }
    return {
      totals,
      errorsByCategory: categoryRows.map((r) => ({ category: r.category as ErrorCategory, count: Number(r.count) })).sort((a, b) => b.count - a.count),
      byAccount: accountRows.map((r) => ({ omieAccountId: r.omieAccountId, name: r.name, total: Number(r.total), completed: Number(r.completed), errors: Number(r.errors) })),
      last7Days: days,
      retryScheduled: Number(retryRow[0]?.count ?? 0),
    };
  }

  async runs(limit: number, job?: string): Promise<SyncRun[]> {
    const rows = await this.db
      .select()
      .from(syncRuns)
      .where(job ? eq(syncRuns.job, job) : undefined)
      .orderBy(desc(syncRuns.startedAt))
      .limit(Math.min(limit, 200));
    return rows.map((r) => ({
      id: r.id,
      job: r.job as SyncRun["job"],
      trigger: r.trigger as SyncTrigger,
      status: r.status as SyncRunStatus,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      windowFrom: r.windowFrom,
      windowTo: r.windowTo,
      stats: (r.stats as SyncRun["stats"]) ?? {},
      error: r.error,
    }));
  }

  async visionFieldPaths(limit: number): Promise<Array<{ path: string; example: unknown; occurrences: number }>> {
    const rows = await this.db
      .select({ payload: integrationOrders.visionPayload })
      .from(integrationOrders)
      .where(isNotNull(integrationOrders.visionPayload))
      .orderBy(desc(integrationOrders.updatedAt))
      .limit(limit);
    const counts = new Map<string, { example: unknown; occurrences: number }>();
    for (const row of rows) {
      for (const [path, example] of collectLeafPaths(row.payload)) {
        const current = counts.get(path);
        if (current) {
          current.occurrences++;
          if ((current.example === null || current.example === "") && example !== null && example !== "") current.example = example;
        } else counts.set(path, { example, occurrences: 1 });
      }
    }
    return [...counts.entries()].map(([path, v]) => ({ path, ...v })).sort((a, b) => a.path.localeCompare(b.path));
  }
}
