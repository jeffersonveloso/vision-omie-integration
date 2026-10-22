import { and, count, desc, eq, ilike, lt, or, type SQL } from "drizzle-orm";
import type { Database } from "@/server/infrastructure/database/client";
import { auditEvents } from "@/server/infrastructure/database/schema";
import type { AuditEntityType, AuditEvent } from "../domain/audit-event";
import type { AuditListFilter, AuditRepository } from "../domain/audit-repository";

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly db: Database) {}

  async append(event: AuditEvent): Promise<void> {
    await this.db.insert(auditEvents).values({ ...event, changes: event.changes as object | null });
  }

  async list(filter: AuditListFilter): Promise<{ items: AuditEvent[]; total: number }> {
    const conditions: SQL[] = [];
    if (filter.entityType) conditions.push(eq(auditEvents.entityType, filter.entityType));
    if (filter.entityId) conditions.push(eq(auditEvents.entityId, filter.entityId));
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim()}%`;
      conditions.push(or(ilike(auditEvents.summary, term), ilike(auditEvents.actor, term), ilike(auditEvents.action, term), eq(auditEvents.requestId, filter.search.trim()))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(auditEvents)
        .where(where)
        .orderBy(desc(auditEvents.at))
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
      this.db.select({ total: count() }).from(auditEvents).where(where),
    ]);
    return {
      total: Number(total),
      items: rows.map((r) => ({ ...r, entityType: r.entityType as AuditEntityType, changes: (r.changes as AuditEvent["changes"]) ?? null })),
    };
  }

  async purgeBefore(date: Date): Promise<number> {
    const deleted = await this.db.delete(auditEvents).where(lt(auditEvents.at, date)).returning({ id: auditEvents.id });
    return deleted.length;
  }
}
