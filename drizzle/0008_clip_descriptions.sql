-- Every uploaded clip in the brand's Assets library, described and tagged by AI (lib/media/describe.ts).
-- Hand-written to match `assets` in lib/db/schema.ts. Additive; no existing row changes.
ALTER TABLE "assets" ADD COLUMN "media_object_id" uuid REFERENCES "media_objects"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_media_object_unique" ON "assets" ("media_object_id");--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "describe_status" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "describe_job_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_describe_job_unique" ON "assets" ("describe_job_id");--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "describe_error" text;
