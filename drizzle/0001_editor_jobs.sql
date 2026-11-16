-- Cloud video editor, stage 1: editor jobs, and the reply that carries a job's cuts.
-- Hand-written to match lib/db/schema-editor.ts and lib/db/schema-conversations.ts. NOT APPLIED:
-- the owner reviews and applies it. Purely additive: two new types, one new table, one new
-- nullable column; no existing row changes.
CREATE TYPE "public"."editor_job_kind" AS ENUM('first_cut', 'revision');--> statement-breakpoint
CREATE TYPE "public"."editor_job_status" AS ENUM('queued', 'running', 'done', 'failed', 'approved');--> statement-breakpoint
CREATE TABLE "editor_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"brand_id" uuid,
	"kind" "editor_job_kind" NOT NULL,
	"status" "editor_job_status" DEFAULT 'queued' NOT NULL,
	"trigger_message_id" uuid,
	"request" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"manifest" jsonb,
	"usage" jsonb,
	"cost_usd" numeric(12, 6),
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Same as every other public table: RLS on with no policies, so only the server's connection reads it.
ALTER TABLE "editor_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "editor_jobs" ADD CONSTRAINT "editor_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_jobs" ADD CONSTRAINT "editor_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_jobs" ADD CONSTRAINT "editor_jobs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_jobs" ADD CONSTRAINT "editor_jobs_trigger_message_id_conversation_messages_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editor_jobs_conversation_idx" ON "editor_jobs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "editor_jobs_workspace_idx" ON "editor_jobs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "editor_jobs_status_idx" ON "editor_jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "editor_jobs_one_active_per_conversation" ON "editor_jobs" USING btree ("conversation_id") WHERE status in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "editor_job_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_editor_job_id_editor_jobs_id_fk" FOREIGN KEY ("editor_job_id") REFERENCES "public"."editor_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_messages_editor_job_idx" ON "conversation_messages" USING btree ("editor_job_id");
