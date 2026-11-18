-- The editor's built-in music library (tracks on R2 under music/library/), platform level.
-- Hand-written to match musicTracks in lib/db/schema-media.ts. Purely additive: one new table.
CREATE TABLE "music_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"r2_key" text NOT NULL,
	"seconds" real NOT NULL,
	"bpm" real,
	"first_beat" real,
	"beat_strength" real,
	"loudest_from" real,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Same as every other public table: RLS on with no policies, so only the server's connection reads it.
ALTER TABLE "music_tracks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "music_tracks_r2_key_unique" ON "music_tracks" USING btree ("r2_key");
