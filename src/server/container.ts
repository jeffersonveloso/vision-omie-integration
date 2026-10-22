import "server-only";
import os from "node:os";
import { systemClock, uuidGenerator } from "@/server/shared/application/ports";
import { AesGcmCipher } from "@/server/shared/infrastructure/aes-cipher";
import { ConsoleLogger } from "@/server/shared/infrastructure/console-logger";
import { env } from "@/server/shared/infrastructure/env";
import { createDatabase, type DatabaseHandle } from "@/server/infrastructure/database/client";
import { FetchDocumentDownloader } from "@/server/infrastructure/http/document-downloader";
import { OmieGatewayFactoryImpl } from "@/server/infrastructure/omie/omie-gateway";
import { OmieRateLimiter } from "@/server/infrastructure/omie/omie-rate-limiter";
import { IntegrationScheduler } from "@/server/infrastructure/scheduler/integration-scheduler";
import { VisionApiClient } from "@/server/infrastructure/vision/vision-api-client";
import { AccountRouter } from "@/server/modules/integration/application/account-router";
import { CustomerSyncService } from "@/server/modules/integration/application/customer-sync";
import type { OmieGatewayFactory, VisionGateway } from "@/server/modules/integration/application/ports";
import { CollectVisionOrders } from "@/server/modules/integration/application/use-cases/collect-vision-orders";
import { CollectionWindowService } from "@/server/modules/integration/application/collection-window";
import { HandleOmieWebhook } from "@/server/modules/integration/application/use-cases/handle-omie-webhook";
import { PurgeOldRecords } from "@/server/modules/integration/application/use-cases/purge-old-records";
import { AuditService } from "@/server/modules/audit/application/audit-service";
import type { AlertChannel } from "@/server/modules/alerts/application/alert-channel";
import { AlertService } from "@/server/modules/alerts/application/alert-service";
import { SlackWebhookChannel } from "@/server/infrastructure/slack/slack-webhook-channel";
import { DrizzleAuditRepository } from "@/server/modules/audit/infrastructure/drizzle-audit-repository";
import { RunReconcileJob, RunSyncJob } from "@/server/modules/integration/application/use-cases/jobs";
import { AcknowledgeVisionUpdate, RetryOrder, RetryOrders, SetOrderIgnored } from "@/server/modules/integration/application/use-cases/order-actions";
import { PreviewOrderMapping } from "@/server/modules/integration/application/use-cases/preview-order-mapping";
import { ProcessOrder } from "@/server/modules/integration/application/use-cases/process-order";
import { ReconcileOrder } from "@/server/modules/integration/application/use-cases/reconcile-order";
import {
  DrizzleCheckpointRepository,
  DrizzleCustomerLinkRepository,
  DrizzleIntegrationLogRepository,
  DrizzleIntegrationOrderRepository,
  DrizzleJobLock,
  DrizzleSyncRunRepository,
  DrizzleWebhookEventStore,
} from "@/server/modules/integration/infrastructure/drizzle-integration-repositories";
import { DrizzleOrderQueryService } from "@/server/modules/integration/infrastructure/drizzle-order-query-service";
import { MappingAdminService } from "@/server/modules/mappings/application/mapping-admin-service";
import { MappingContextFactory } from "@/server/modules/mappings/application/mapping-context-factory";
import {
  DrizzleFieldRuleRepository,
  DrizzleValueMapEntryRepository,
  DrizzleValueMapRepository,
} from "@/server/modules/mappings/infrastructure/drizzle-mapping-repositories";
import { OmieAccountService } from "@/server/modules/omie-accounts/application/omie-account-service";
import { DrizzleLookupCache } from "@/server/modules/omie-accounts/infrastructure/drizzle-lookup-cache";
import { DrizzleOmieAccountRepository } from "@/server/modules/omie-accounts/infrastructure/drizzle-omie-account-repository";
import { SettingsService } from "@/server/modules/settings/application/settings-service";
import { settingsDefaults } from "@/server/modules/settings/domain/integration-settings";
import { DrizzleSettingsRepository } from "@/server/modules/settings/infrastructure/drizzle-settings-repository";

export interface ContainerOverrides {
  databaseUrl?: string;
  vision?: VisionGateway;
  omie?: OmieGatewayFactory;
  fetchImpl?: typeof fetch;
  /** Canal de alertas (testes usam um canal em memória no lugar do Slack). */
  alertChannel?: AlertChannel;
  appBaseUrl?: string;
}

/**
 * Composition Root: único ponto que conhece implementações concretas.
 * Ao migrar o backend para NestJS, este arquivo vira o conjunto de providers dos módulos;
 * domínio e aplicação são reaproveitados sem alteração.
 */
export async function buildContainer(overrides: ContainerOverrides = {}) {
  const config = env();
  const logger = new ConsoleLogger("vision-omie");
  const clock = systemClock;
  const ids = uuidGenerator;
  const timeZone = config.APP_TIMEZONE;
  const instanceId = `${os.hostname()}-${process.pid}-${ids.next().slice(0, 8)}`;

  const database: DatabaseHandle = await createDatabase({ url: overrides.databaseUrl ?? config.DATABASE_URL, pgliteDir: config.PGLITE_DATA_DIR });
  const { db } = database;
  const cipher = new AesGcmCipher(config.APP_ENCRYPTION_KEY, () => {
    if (config.NODE_ENV === "production") logger.warn("APP_ENCRYPTION_KEY não definida: usando chave de desenvolvimento para os App Secrets.");
  });

  // Repositórios
  const accounts = new DrizzleOmieAccountRepository(db, cipher);
  const lookupCache = new DrizzleLookupCache(db);
  const settingsRepo = new DrizzleSettingsRepository(db, settingsDefaults({ initialLookbackDays: config.SYNC_INITIAL_LOOKBACK_DAYS }));
  const fieldRules = new DrizzleFieldRuleRepository(db);
  const valueMaps = new DrizzleValueMapRepository(db);
  const valueMapEntries = new DrizzleValueMapEntryRepository(db);
  const orders = new DrizzleIntegrationOrderRepository(db);
  const logs = new DrizzleIntegrationLogRepository(db);
  const runs = new DrizzleSyncRunRepository(db);
  const checkpoints = new DrizzleCheckpointRepository(db);
  const customerLinks = new DrizzleCustomerLinkRepository(db);
  const jobLock = new DrizzleJobLock(db);
  const webhookEvents = new DrizzleWebhookEventStore(db);
  const audit = new AuditService(new DrizzleAuditRepository(db), ids, clock, logger);
  const queries = new DrizzleOrderQueryService(db, timeZone);

  // Adaptadores externos
  const vision: VisionGateway =
    overrides.vision ??
    new VisionApiClient({ baseUrl: config.VISION_API_URL, username: config.VISION_USERNAME, password: config.VISION_PASSWORD, timeoutMs: config.VISION_TIMEOUT_MS, timeZone: config.APP_TIMEZONE }, overrides.fetchImpl);
  const omie: OmieGatewayFactory =
    overrides.omie ?? new OmieGatewayFactoryImpl({ baseUrl: config.OMIE_API_URL, timeoutMs: config.OMIE_TIMEOUT_MS, maxInlineRetries: 2, readCacheTtlMs: config.OMIE_READ_CACHE_MS }, new OmieRateLimiter(), overrides.fetchImpl);
  const downloader = new FetchDocumentDownloader();

  // Serviços de aplicação
  const settings = new SettingsService(settingsRepo);
  const omieAccounts = new OmieAccountService(accounts, omie, lookupCache, ids, clock);
  const mappingAdmin = new MappingAdminService(fieldRules, valueMaps, valueMapEntries, ids, clock);
  const mappingContexts = new MappingContextFactory(fieldRules, valueMaps, valueMapEntries, clock, timeZone);
  const router = new AccountRouter(accounts, valueMapEntries);
  const customers = new CustomerSyncService(customerLinks, clock);

  const collect = new CollectVisionOrders({ vision, orders, checkpoints, settings: settingsRepo, logs, ids, clock, timeZone });
  const collectionWindow = new CollectionWindowService({ checkpoints, settings: settingsRepo, clock, timeZone });
  const processOrder = new ProcessOrder({ orders, vision, omie, router, mappingContexts, customers, settings: settingsRepo, logs, ids, clock, timeZone });
  const reconcileOrder = new ReconcileOrder({ orders, accounts, entries: valueMapEntries, omie, vision, downloader, settings: settingsRepo, logs, clock, timeZone });
  const retryOrder = new RetryOrder({ orders, process: processOrder, reconcile: reconcileOrder, logs, clock });
  const retryOrders = new RetryOrders({ orders, retry: retryOrder });
  const setIgnored = new SetOrderIgnored({ orders, logs, clock });
  const acknowledgeUpdate = new AcknowledgeVisionUpdate({ orders, clock });
  const preview = new PreviewOrderMapping({ orders, accounts, router, mappingContexts, vision, settings: settingsRepo, timeZone });
  const webhook = new HandleOmieWebhook({ orders, events: webhookEvents, logs, ids, clock });

  const alerts = new AlertService({ channel: overrides.alertChannel ?? new SlackWebhookChannel(config.SLACK_WEBHOOK_URL, overrides.fetchImpl), settings: settingsRepo, checkpoints, clock, logger, timeZone, appBaseUrl: overrides.appBaseUrl ?? config.APP_BASE_URL ?? null });
  const jobDeps = { orders, runs, lock: jobLock, settings: settingsRepo, ids, clock, logger, instanceId, notifier: alerts };
  const syncJob = new RunSyncJob({ ...jobDeps, collect, process: processOrder });
  const reconcileJob = new RunReconcileJob({ ...jobDeps, reconcile: reconcileOrder });
  const maintenance = new PurgeOldRecords({ logs, runs, webhooks: webhookEvents, audit, settings: settingsRepo, lock: jobLock, clock, logger, instanceId });
  const scheduler = new IntegrationScheduler({ settings: settingsRepo, sync: syncJob, reconcile: reconcileJob, maintenance, logger, timeZone });
  settings.attachScheduler(scheduler);

  await mappingAdmin.ensureSystemMaps();

  return {
    config,
    logger,
    database,
    timeZone,
    vision,
    queries,
    settings,
    omieAccounts,
    mappingAdmin,
    collectionWindow,
    audit,
    alerts,
    useCases: { collect, processOrder, reconcileOrder, retryOrder, retryOrders, setIgnored, acknowledgeUpdate, preview, webhook, syncJob, reconcileJob, maintenance },
    scheduler,
  };
}

export type AppContainer = Awaited<ReturnType<typeof buildContainer>>;

const globalForContainer = globalThis as unknown as { __visionOmieContainer?: Promise<AppContainer> };

/** Singleton por processo (sobrevive ao hot reload em desenvolvimento). */
export function getContainer(): Promise<AppContainer> {
  if (!globalForContainer.__visionOmieContainer) {
    globalForContainer.__visionOmieContainer = buildContainer().catch((error) => {
      globalForContainer.__visionOmieContainer = undefined;
      throw error;
    });
  }
  return globalForContainer.__visionOmieContainer;
}
