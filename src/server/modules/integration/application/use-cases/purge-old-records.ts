import type { AppLogger, Clock } from "@/server/shared/application/ports";
import { addDays } from "@/server/shared/domain/dates";
import type { AuditService } from "@/server/modules/audit/application/audit-service";
import { SYSTEM_CONTEXT } from "@/server/modules/audit/domain/audit-event";
import type { SettingsRepository } from "@/server/modules/settings/domain/integration-settings";
import type { IntegrationLogRepository, JobLock, SyncRunRepository } from "../../domain/repositories";
import type { WebhookEventRepository } from "../../domain/webhook-event";

export interface PurgeResult {
  logs: number;
  runs: number;
  webhooks: number;
  audit: number;
  sessions: number;
}

/**
 * Retenção dos registros (Configurações › Retenção de logs). Roda uma vez por dia.
 * O erro atual de cada pedido fica no próprio pedido, então apagar logs antigos não esconde pendências.
 */
export class PurgeOldRecords {
  constructor(
    private readonly deps: {
      logs: IntegrationLogRepository;
      runs: SyncRunRepository;
      webhooks: Pick<WebhookEventRepository, "purgeBefore">;
      audit: AuditService;
      /** Sessões do login vencidas (opcional: não existe com AUTH_MODE=proxy). */
      sessions?: { purgeExpiredSessions(): Promise<number> };
      settings: SettingsRepository;
      lock: JobLock;
      clock: Clock;
      logger: AppLogger;
      instanceId: string;
    },
  ) {}

  async execute(): Promise<PurgeResult | null> {
    const { logs, runs, webhooks, audit, sessions, settings: settingsRepo, lock, clock, logger, instanceId } = this.deps;
    if (!(await lock.tryAcquire("maintenance", instanceId, 30 * 60_000))) return null;
    try {
      const { logs: retention } = await settingsRepo.get();
      const now = clock.now();
      const result: PurgeResult = {
        logs: await logs.purge({ before: addDays(now, -retention.retentionDays), errorsBefore: addDays(now, -retention.errorRetentionDays) }),
        runs: await runs.purgeBefore(addDays(now, -retention.errorRetentionDays)),
        webhooks: await webhooks.purgeBefore(addDays(now, -retention.retentionDays)),
        audit: await audit.purgeBefore(addDays(now, -retention.auditRetentionDays)),
        sessions: (await sessions?.purgeExpiredSessions()) ?? 0,
      };
      const total = result.logs + result.runs + result.webhooks + result.audit;
      logger.info("Limpeza de registros antigos concluída", { ...result });
      if (total > 0) {
        await audit.record(SYSTEM_CONTEXT, {
          action: "logs.purge",
          entityType: "SYSTEM",
          summary: `Limpeza automática: ${result.logs} registro(s) da linha do tempo, ${result.runs} execução(ões), ${result.webhooks} webhook(s) e ${result.audit} evento(s) de auditoria.`,
          changes: { ...result, retencao: retention },
        });
      }
      return result;
    } finally {
      await lock.release("maintenance", instanceId);
    }
  }
}
