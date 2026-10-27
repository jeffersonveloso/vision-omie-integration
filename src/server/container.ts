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
import type { OmieGatewayFactory, VisionGateway, WebhookQueue } from "@/server/modules/integration/application/ports";
import { CollectVisionOrders } from "@/server/modules/integration/application/use-cases/collect-vision-orders";
import { CollectionWindowService } from "@/server/modules/integration/application/collection-window";
import { ProcessOmieWebhookEvent, ReceiveOmieWebhook, RetryWebhookEvents, SweepWebhookEvents } from "@/server/modules/integration/application/use-cases/omie-webhooks";
import { BullMqWebhookQueue } from "@/server/infrastructure/queue/bullmq-webhook-queue";
import { InMemoryWebhookQueue } from "@/server/infrastructure/queue/in-memory-webhook-queue";
import { PurgeOldRecords } from "@/server/modules/integration/application/use-cases/purge-old-records";
import { AuditService } from "@/server/modules/audit/application/audit-service";
import { SYSTEM_CONTEXT } from "@/server/modules/audit/domain/audit-event";
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
  DrizzleWebhookEventRepository,
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
import { AuthService, UserAdminService } from "@/server/modules/identity/application/auth-service";
import { DrizzleSessionRepository, DrizzleUserRepository } from "@/server/modules/identity/infrastructure/drizzle-identity-repositories";
import { ScryptPasswordHasher } from "@/server/modules/identity/infrastructure/scrypt-password-hasher";
import type { PasswordHasher } from "@/server/modules/identity/domain/user";

export interface ContainerOverrides {
  databaseUrl?: string;
  vision?: VisionGateway;
  omie?: OmieGatewayFactory;
  fetchImpl?: typeof fetch;
  /** Fila de webhooks (testes podem trocar por uma fila controlada). */
  webhookQueue?: WebhookQueue;
  /** Canal de alertas (testes usam um canal em memória no lugar do Slack). */
  alertChannel?: AlertChannel;
  appBaseUrl?: string;
  /** Hash de senha (testes usam um custo menor para ficarem rápidos). */
  passwordHasher?: PasswordHasher;
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
  const webhookEvents = new DrizzleWebhookEventRepository(db);
  const audit = new AuditService(new DrizzleAuditRepository(db), ids, clock, logger);
  const queries = new DrizzleOrderQueryService(db, timeZone);

  // Login próprio (AUTH_MODE=local)
  const identityDeps = { users: new DrizzleUserRepository(db), sessions: new DrizzleSessionRepository(db), hasher: overrides.passwordHasher ?? new ScryptPasswordHasher(), ids, clock };
  const auth = new AuthService({
    ...identityDeps,
    policy: { idleHours: config.AUTH_SESSION_IDLE_HOURS, maxDays: config.AUTH_SESSION_MAX_DAYS, maxFailedLogins: 5, lockMinutes: 15 },
  });
  const userAdmin = new UserAdminService(identityDeps);

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
  // Fila dos webhooks do Omie: Redis/BullMQ em produção, memória sem REDIS_URL.
  const webhookQueue =
    overrides.webhookQueue ??
    (config.REDIS_URL
      ? new BullMqWebhookQueue(config.REDIS_URL, { prefix: config.REDIS_PREFIX, attempts: 6, backoffMs: 15_000, concurrency: 2, logger })
      : new InMemoryWebhookQueue({ attempts: 6, backoffMs: 15_000, logger }));
  const receiveWebhook = new ReceiveOmieWebhook({ events: webhookEvents, queue: webhookQueue, ids, clock, logger });
  const processWebhook = new ProcessOmieWebhookEvent({ events: webhookEvents, orders, accounts, reconcile: reconcileOrder, logs, clock });
  const retryWebhooks = new RetryWebhookEvents({ events: webhookEvents, queue: webhookQueue, clock });
  const sweepWebhooks = new SweepWebhookEvents({ events: webhookEvents, queue: webhookQueue, clock, logger });
  /** Liga o worker da fila neste processo (no Next via instrumentation, ou no `npm run worker`). */
  const startWebhookWorker = () => webhookQueue.startWorker((eventId, context) => processWebhook.execute(eventId, context));
  // Na fila em memória o processamento só existe neste processo: o worker liga junto.
  if (webhookQueue.mode === "memory") await startWebhookWorker();

  const alerts = new AlertService({ channel: overrides.alertChannel ?? new SlackWebhookChannel(config.SLACK_WEBHOOK_URL, overrides.fetchImpl), settings: settingsRepo, checkpoints, clock, logger, timeZone, appBaseUrl: overrides.appBaseUrl ?? config.APP_BASE_URL ?? null });
  const jobDeps = { orders, runs, lock: jobLock, settings: settingsRepo, ids, clock, logger, instanceId, notifier: alerts };
  const syncJob = new RunSyncJob({ ...jobDeps, collect, process: processOrder });
  const reconcileJob = new RunReconcileJob({ ...jobDeps, reconcile: reconcileOrder });
  const maintenance = new PurgeOldRecords({ logs, runs, webhooks: webhookEvents, audit, sessions: auth, settings: settingsRepo, lock: jobLock, clock, logger, instanceId });
  const scheduler = new IntegrationScheduler({ settings: settingsRepo, sync: syncJob, reconcile: reconcileJob, maintenance, webhookSweep: sweepWebhooks, logger, timeZone });
  settings.attachScheduler(scheduler);

  await mappingAdmin.ensureSystemMaps();

  if (config.AUTH_MODE === "local") {
    const admin = await userAdmin.bootstrapAdmin({ email: config.AUTH_ADMIN_EMAIL, password: config.AUTH_ADMIN_PASSWORD, name: config.AUTH_ADMIN_NAME });
    if (admin) {
      logger.info("Primeiro administrador criado a partir de AUTH_ADMIN_EMAIL", { email: admin.email });
      await audit.record(SYSTEM_CONTEXT, { action: "user.bootstrap", entityType: "USER", entityId: admin.id, summary: `Primeiro administrador ${admin.email} criado pelas variáveis de ambiente.` });
    }
    if (config.AUTH_API_TOKEN && config.AUTH_API_TOKEN.length < 32) logger.warn("AUTH_API_TOKEN tem menos de 32 caracteres e foi ignorado.");
  }

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
    auth,
    userAdmin,
    alerts,
    webhookQueue,
    webhookEvents,
    startWebhookWorker,
    useCases: { collect, processOrder, reconcileOrder, retryOrder, retryOrders, setIgnored, acknowledgeUpdate, preview, receiveWebhook, processWebhook, retryWebhooks, sweepWebhooks, syncJob, reconcileJob, maintenance },
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
