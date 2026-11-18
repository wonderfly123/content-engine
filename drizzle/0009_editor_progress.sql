-- What the editor is doing, step by step, shown in the chat while it works (lib/editor/progress.ts).
-- Hand-written to match editor_jobs in lib/db/schema-editor.ts. Additive.
ALTER TABLE "editor_jobs" ADD COLUMN "progress" jsonb DEFAULT '[]'::jsonb NOT NULL;
