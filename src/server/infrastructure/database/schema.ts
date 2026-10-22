import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Bases Omie de destino. O App Secret é gravado criptografado (AES-256-GCM). */
export const omieAccounts = pgTable("omie_accounts", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  appKey: text("app_key").notNull(),
  appSecretEncrypted: text("app_secret_encrypted").notNull(),
  cnpj: text("cnpj").notNull().unique(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  lastCheckAt: ts("last_check_at"),
  lastCheckOk: boolean("last_check_ok"),
  lastCheckMessage: text("last_check_message"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const valueMaps = pgTable("value_maps", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  omieEntity: text("omie_entity").notNull(),
  description: text("description"),
  visionSourceHint: text("vision_source_hint"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const valueMapEntries = pgTable(
  "value_map_entries",
  {
    id: uuid("id").primaryKey(),
    valueMapId: uuid("value_map_id").notNull().references(() => valueMaps.id, { onDelete: "cascade" }),
    omieAccountId: uuid("omie_account_id").notNull().references(() => omieAccounts.id, { onDelete: "cascade" }),
    visionValue: text("vision_value").notNull(),
    visionLabel: text("vision_label"),
    omieValue: text("omie_value").notNull(),
    omieLabel: text("omie_label"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("value_map_entries_unique").on(t.valueMapId, t.omieAccountId, t.visionValue),
    index("value_map_entries_account_idx").on(t.omieAccountId),
  ],
);

export const fieldRules = pgTable(
  "field_rules",
  {
    id: uuid("id").primaryKey(),
    omieAccountId: uuid("omie_account_id").references(() => omieAccounts.id, { onDelete: "cascade" }),
    /** `global` ou o id da conta — permite índice único com regra global (account nulo). */
    scopeKey: text("scope_key").notNull(),
    documentType: text("document_type").notNull(),
    targetField: text("target_field").notNull(),
    sourceType: text("source_type").notNull(),
    sourcePath: text("source_path"),
    constantValue: text("constant_value"),
    valueMapKey: text("value_map_key"),
    transforms: jsonb("transforms").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    defaultValue: text("default_value"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("field_rules_scope_unique").on(t.scopeKey, t.documentType, t.targetField)],
);

export const integrationOrders = pgTable(
  "integration_orders",
  {
    id: uuid("id").primaryKey(),
    visionOrderCode: bigint("vision_order_code", { mode: "number" }).notNull().unique(),
    visionCompanyCode: bigint("vision_company_code", { mode: "number" }),
    visionStatusCode: integer("vision_status_code"),
    visionStatusDescription: text("vision_status_description"),
    visionUpdatedAt: ts("vision_updated_at"),
    companyCnpj: text("company_cnpj"),
    omieAccountId: uuid("omie_account_id").references(() => omieAccounts.id, { onDelete: "set null" }),
    customerName: text("customer_name"),
    customerDocument: text("customer_document"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2, mode: "number" }),
    status: text("status").notNull(),
    lastError: jsonb("last_error"),
    errorCategory: text("error_category"),
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: ts("next_retry_at"),
    processingUntil: ts("processing_until"),
    updatedAfterSync: boolean("updated_after_sync").notNull().default(false),
    ignored: boolean("ignored").notNull().default(false),
    visionSummary: jsonb("vision_summary"),
    visionPayload: jsonb("vision_payload"),
    firstSeenAt: ts("first_seen_at").notNull(),
    lastProcessedAt: ts("last_processed_at"),
    lastCheckedAt: ts("last_checked_at"),
    completedAt: ts("completed_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    index("integration_orders_status_idx").on(t.status),
    index("integration_orders_retry_idx").on(t.nextRetryAt),
    index("integration_orders_account_idx").on(t.omieAccountId),
    index("integration_orders_updated_idx").on(t.updatedAt),
  ],
);

export const omieDocuments = pgTable(
  "omie_documents",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull().references(() => integrationOrders.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    integrationCode: text("integration_code").notNull(),
    omieId: bigint("omie_id", { mode: "number" }),
    omieNumber: text("omie_number"),
    status: text("status").notNull(),
    fiscal: jsonb("fiscal"),
    fiscalReturn: jsonb("fiscal_return").notNull().default(sql`'{}'::jsonb`),
    titles: jsonb("titles").notNull().default(sql`'[]'::jsonb`),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    sentAt: ts("sent_at"),
    lastCheckedAt: ts("last_checked_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("omie_documents_order_kind").on(t.orderId, t.kind), index("omie_documents_omie_id_idx").on(t.omieId)],
);

export const customerLinks = pgTable(
  "customer_links",
  {
    omieAccountId: uuid("omie_account_id").notNull().references(() => omieAccounts.id, { onDelete: "cascade" }),
    visionCustomerKey: text("vision_customer_key").notNull(),
    omieCustomerId: bigint("omie_customer_id", { mode: "number" }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    syncedAt: ts("synced_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.omieAccountId, t.visionCustomerKey] })],
);

export const integrationLogs = pgTable(
  "integration_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: uuid("order_id").references(() => integrationOrders.id, { onDelete: "cascade" }),
    runId: uuid("run_id"),
    level: text("level").notNull(),
    step: text("step"),
    message: text("message").notNull(),
    data: jsonb("data"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("integration_logs_order_idx").on(t.orderId, t.createdAt), index("integration_logs_run_idx").on(t.runId), index("integration_logs_created_idx").on(t.createdAt)],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey(),
    job: text("job").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    startedAt: ts("started_at").notNull(),
    finishedAt: ts("finished_at"),
    windowFrom: text("window_from"),
    windowTo: text("window_to"),
    stats: jsonb("stats").notNull().default(sql`'{}'::jsonb`),
    error: text("error"),
  },
  (t) => [index("sync_runs_started_idx").on(t.startedAt)],
);

export const syncCheckpoints = pgTable("sync_checkpoints", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const jobLocks = pgTable("job_locks", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  lockedUntil: ts("locked_until").notNull(),
});

export const lookupCache = pgTable(
  "lookup_cache",
  {
    omieAccountId: uuid("omie_account_id").notNull().references(() => omieAccounts.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    options: jsonb("options").notNull(),
    fetchedAt: ts("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.omieAccountId, t.entity] })],
);

/**
 * Webhooks recebidos do Omie. O banco é a fonte da verdade (gravado antes de enfileirar);
 * a fila (Redis/BullMQ) só transporta o id do evento até o worker.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey(),
    source: text("source").notNull(),
    /** messageId do Omie: o mesmo evento reenviado não é processado duas vezes. */
    messageId: text("message_id"),
    topic: text("topic"),
    appKey: text("app_key"),
    omieAccountId: uuid("omie_account_id"),
    payload: jsonb("payload").notNull(),
    /** RECEIVED → QUEUED → PROCESSING → DONE | IGNORED | FAILED */
    status: text("status").notNull().default("RECEIVED"),
    attempts: integer("attempts").notNull().default(0),
    note: text("note"),
    lastError: text("last_error"),
    relatedOrderId: uuid("related_order_id"),
    receivedAt: ts("received_at").notNull(),
    enqueuedAt: ts("enqueued_at"),
    processedAt: ts("processed_at"),
  },
  (t) => [uniqueIndex("webhook_events_message_idx").on(t.source, t.messageId), index("webhook_events_status_idx").on(t.status, t.receivedAt)],
);

/**
 * Auditoria: quem mudou o quê (contas, mapeamentos, configurações) e ações manuais nos pedidos.
 * O autor vem do cabeçalho do proxy autenticado (ex.: X-Forwarded-Email do oauth2-proxy).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    at: ts("at").notNull(),
    actor: text("actor"),
    ip: text("ip"),
    requestId: text("request_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    changes: jsonb("changes"),
  },
  (t) => [index("audit_events_at_idx").on(t.at), index("audit_events_entity_idx").on(t.entityType, t.entityId)],
);
