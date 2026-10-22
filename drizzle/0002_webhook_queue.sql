ALTER TABLE "webhook_events" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "app_key" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "omie_account_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "status" text DEFAULT 'RECEIVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "enqueued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_message_idx" ON "webhook_events" USING btree ("source","message_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status","received_at");--> statement-breakpoint
-- Eventos anteriores à fila já foram processados no recebimento.
UPDATE "webhook_events" SET "status" = 'DONE', "processed_at" = "received_at" WHERE "processed_at" IS NULL;