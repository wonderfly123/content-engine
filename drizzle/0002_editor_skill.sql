-- Cloud video editor: the skill's markdown files as edited in Admin, one row per save.
-- Hand-written to match editorSkillVersions in lib/db/schema-editor.ts. NOT APPLIED: the owner
-- reviews and applies it. Purely additive: one new table; no existing row changes.
-- A file's current version is its newest row; a file with no rows uses the repo copy.
CREATE TABLE "editor_skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);--> statement-breakpoint
-- Same as every other public table: RLS on with no policies, so only the server's connection reads it.
ALTER TABLE "editor_skill_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "editor_skill_versions_path_idx" ON "editor_skill_versions" USING btree ("path","created_at");
