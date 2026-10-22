import type { AuditEntityType, AuditEvent } from "./audit-event";

export interface AuditListFilter {
  entityType?: AuditEntityType | null;
  entityId?: string | null;
  search?: string | null;
  page: number;
  pageSize: number;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  list(filter: AuditListFilter): Promise<{ items: AuditEvent[]; total: number }>;
  purgeBefore(date: Date): Promise<number>;
}
