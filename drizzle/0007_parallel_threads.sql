-- Several videos at once: a person can have more than one open thread, each named by the editor.
-- Hand-written to match conversations in lib/db/schema-conversations.ts. Additive apart from
-- dropping the one-open-thread-per-person rule; no existing row changes.
ALTER TABLE "conversations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "description" text;--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_one_open_per_user";
