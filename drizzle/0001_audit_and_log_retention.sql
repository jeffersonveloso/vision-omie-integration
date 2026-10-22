CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text,
	"ip" text,
	"request_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text NOT NULL,
	"changes" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "integration_logs_created_idx" ON "integration_logs" USING btree ("created_at");