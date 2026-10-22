import type { AppLogger, Clock, IdGenerator } from "@/server/shared/application/ports";
import type { AuditChange, AuditContext, AuditEntityType, AuditEvent } from "../domain/audit-event";
import type { AuditListFilter, AuditRepository } from "../domain/audit-repository";

export interface AuditInput {
  action: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  summary: string;
  changes?: AuditChange[] | Record<string, unknown> | null;
}

export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  /** Nunca derruba a operação auditada: falha ao gravar vira log de erro. */
  async record(context: AuditContext, input: AuditInput): Promise<void> {
    const event: AuditEvent = {
      id: this.ids.next(),
      at: this.clock.now(),
      actor: context.actor,
      ip: context.ip,
      requestId: context.requestId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      changes: input.changes && (!Array.isArray(input.changes) || input.changes.length) ? input.changes : null,
    };
    try {
      await this.repository.append(event);
    } catch (error) {
      this.logger.error("Falha ao gravar auditoria", { requestId: context.requestId, action: input.action, error: String(error) });
    }
  }

  list(filter: AuditListFilter) {
    return this.repository.list(filter);
  }

  purgeBefore(date: Date): Promise<number> {
    return this.repository.purgeBefore(date);
  }
}
