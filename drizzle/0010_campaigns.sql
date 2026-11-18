-- Campaigns: one chat that brainstorms a plan of many videos with a posting calendar, then makes them
-- one at a time (lib/campaigns). Hand-written to match lib/db/schema-campaigns.ts and editor_jobs in
-- lib/db/schema-editor.ts. Additive; no existing row changes.
-- ADD VALUE cannot be used in the same transaction that adds it; nothing below uses it.
ALTER TYPE "conversation_kind" ADD VALUE IF NOT EXISTS 'campaign';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
	"name" text DEFAULT '' NOT NULL,
	"theme" text DEFAULT '' NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"plan_written_at" timestamp with time zone,
	"calendar_approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_conversation_unique" ON "campaigns" ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_brand_idx" ON "campaigns" ("brand_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"angle" text DEFAULT '' NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"length_sec" integer NOT NULL,
	"format" text NOT NULL,
	"music" text DEFAULT '' NOT NULL,
	"asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_items_campaign_idx" ON "campaign_items" ("campaign_id","position");--> statement-breakpoint
ALTER TABLE "editor_jobs" ADD COLUMN "campaign_item_id" uuid REFERENCES "campaign_items"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "editor_jobs" ADD COLUMN "clip_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_jobs_campaign_item_idx" ON "editor_jobs" ("campaign_item_id","created_at");
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_items" ENABLE ROW LEVEL SECURITY;
