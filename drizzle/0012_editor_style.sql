-- Per-brand editor style (Settings > Editor style): one row per save of one section, and the small
-- tweaks the app suggests after an approval or a change request. Hand-written to match
-- lib/db/schema-style.ts. NOT APPLIED: the owner reviews and applies it. Purely additive.
-- A section's current value is its newest row; a brand with no rows edits exactly as before.
CREATE TABLE IF NOT EXISTS "editor_style_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"section" text NOT NULL,
	"value" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_style_versions_brand_section_idx" ON "editor_style_versions" ("brand_id","section","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "editor_style_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"section" text NOT NULL,
	"change" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"editor_job_id" uuid REFERENCES "editor_jobs"("id") ON DELETE SET NULL,
	"conversation_id" uuid REFERENCES "conversations"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid
);--> statement-breakpoint
-- At most one pending suggestion per brand and section, so they never pile up.
CREATE UNIQUE INDEX IF NOT EXISTS "editor_style_suggestions_pending_unique" ON "editor_style_suggestions" ("brand_id","section") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_style_suggestions_brand_idx" ON "editor_style_suggestions" ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editor_style_suggestions_job_idx" ON "editor_style_suggestions" ("editor_job_id");--> statement-breakpoint
-- Same as every other public table: RLS on with no policies, so only the server's connection reads it.
ALTER TABLE "editor_style_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "editor_style_suggestions" ENABLE ROW LEVEL SECURITY;
