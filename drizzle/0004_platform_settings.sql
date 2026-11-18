-- Platform-wide settings changed in Admin (one row per key), first used for how long raw clips are kept.
-- Hand-written to match platformSettings in lib/db/schema-media.ts. Purely additive: one new table.
-- No row means the default (raw clips kept forever), so nothing is deleted until the admin chooses.
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Same as every other public table: RLS on with no policies, so only the server's connection reads it.
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;
