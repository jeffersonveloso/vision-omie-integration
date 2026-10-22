CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_links" (
	"omie_account_id" uuid NOT NULL,
	"vision_customer_key" text NOT NULL,
	"omie_customer_id" bigint NOT NULL,
	"payload_hash" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "customer_links_omie_account_id_vision_customer_key_pk" PRIMARY KEY("omie_account_id","vision_customer_key")
);
--> statement-breakpoint
CREATE TABLE "field_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"omie_account_id" uuid,
	"scope_key" text NOT NULL,
	"document_type" text NOT NULL,
	"target_field" text NOT NULL,
	"source_type" text NOT NULL,
	"source_path" text,
	"constant_value" text,
	"value_map_key" text,
	"transforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_value" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" uuid,
	"run_id" uuid,
	"level" text NOT NULL,
	"step" text,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vision_order_code" bigint NOT NULL,
	"vision_company_code" bigint,
	"vision_status_code" integer,
	"vision_status_description" text,
	"vision_updated_at" timestamp with time zone,
	"company_cnpj" text,
	"omie_account_id" uuid,
	"customer_name" text,
	"customer_document" text,
	"total_amount" numeric(14, 2),
	"status" text NOT NULL,
	"last_error" jsonb,
	"error_category" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"processing_until" timestamp with time zone,
	"updated_after_sync" boolean DEFAULT false NOT NULL,
	"ignored" boolean DEFAULT false NOT NULL,
	"vision_summary" jsonb,
	"vision_payload" jsonb,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_processed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "integration_orders_vision_order_code_unique" UNIQUE("vision_order_code")
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"name" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"locked_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lookup_cache" (
	"omie_account_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"options" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lookup_cache_omie_account_id_entity_pk" PRIMARY KEY("omie_account_id","entity")
);
--> statement-breakpoint
CREATE TABLE "omie_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_key" text NOT NULL,
	"app_secret_encrypted" text NOT NULL,
	"cnpj" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_check_ok" boolean,
	"last_check_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "omie_accounts_cnpj_unique" UNIQUE("cnpj")
);
--> statement-breakpoint
CREATE TABLE "omie_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"integration_code" text NOT NULL,
	"omie_id" bigint,
	"omie_number" text,
	"status" text NOT NULL,
	"fiscal" jsonb,
	"fiscal_return" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"sent_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_checkpoints" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"window_from" text,
	"window_to" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "value_map_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"value_map_id" uuid NOT NULL,
	"omie_account_id" uuid NOT NULL,
	"vision_value" text NOT NULL,
	"vision_label" text,
	"omie_value" text NOT NULL,
	"omie_label" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "value_maps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"omie_entity" text NOT NULL,
	"description" text,
	"vision_source_hint" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "value_maps_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"topic" text,
	"payload" jsonb NOT NULL,
	"related_order_id" uuid,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_links" ADD CONSTRAINT "customer_links_omie_account_id_omie_accounts_id_fk" FOREIGN KEY ("omie_account_id") REFERENCES "public"."omie_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_rules" ADD CONSTRAINT "field_rules_omie_account_id_omie_accounts_id_fk" FOREIGN KEY ("omie_account_id") REFERENCES "public"."omie_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_logs" ADD CONSTRAINT "integration_logs_order_id_integration_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."integration_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_orders" ADD CONSTRAINT "integration_orders_omie_account_id_omie_accounts_id_fk" FOREIGN KEY ("omie_account_id") REFERENCES "public"."omie_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_cache" ADD CONSTRAINT "lookup_cache_omie_account_id_omie_accounts_id_fk" FOREIGN KEY ("omie_account_id") REFERENCES "public"."omie_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omie_documents" ADD CONSTRAINT "omie_documents_order_id_integration_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."integration_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_map_entries" ADD CONSTRAINT "value_map_entries_value_map_id_value_maps_id_fk" FOREIGN KEY ("value_map_id") REFERENCES "public"."value_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_map_entries" ADD CONSTRAINT "value_map_entries_omie_account_id_omie_accounts_id_fk" FOREIGN KEY ("omie_account_id") REFERENCES "public"."omie_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_rules_scope_unique" ON "field_rules" USING btree ("scope_key","document_type","target_field");--> statement-breakpoint
CREATE INDEX "integration_logs_order_idx" ON "integration_logs" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_logs_run_idx" ON "integration_logs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "integration_orders_status_idx" ON "integration_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_orders_retry_idx" ON "integration_orders" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "integration_orders_account_idx" ON "integration_orders" USING btree ("omie_account_id");--> statement-breakpoint
CREATE INDEX "integration_orders_updated_idx" ON "integration_orders" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "omie_documents_order_kind" ON "omie_documents" USING btree ("order_id","kind");--> statement-breakpoint
CREATE INDEX "omie_documents_omie_id_idx" ON "omie_documents" USING btree ("omie_id");--> statement-breakpoint
CREATE INDEX "sync_runs_started_idx" ON "sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "value_map_entries_unique" ON "value_map_entries" USING btree ("value_map_id","omie_account_id","vision_value");--> statement-breakpoint
CREATE INDEX "value_map_entries_account_idx" ON "value_map_entries" USING btree ("omie_account_id");