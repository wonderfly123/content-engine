-- The editor's music library per brand (Settings > Music) instead of platform-wide (Admin > Music).
-- Hand-written to match musicTracks in lib/db/schema-media.ts. NOT APPLIED: the owner reviews and applies it.
-- Additive: the original rows stay where they are (kept cuts may name their ids; the editor callback still
-- accepts them, lib/music/library.ts usableTracks). Safe to run again: every step is IF NOT EXISTS or
-- ON CONFLICT DO NOTHING.
--   1. brand_id (nullable, cascades with the brand) and its index.
--   2. Uniqueness moves from r2_key to (brand_id, r2_key): many brands share one R2 object. Postgres treats
--      NULLs as distinct there, so rows with no brand (platform and legacy workspace tracks) keep their own
--      partial unique on r2_key (scripts/import-music.ts upserts against it).
--   3. Every platform track (no workspace, no brand) is copied into every brand, whatever its status, and
--      every workspace-owned track (no brand) into each brand of that workspace, keeping title, beat data,
--      active and source; the copy's workspace_id is the brand's workspace.
--   4. Brands that now have tracks are marked musicSeeded in settings_json, so the app never copies the
--      platform library into them again (lib/music/library.ts ensureBrandTracks). Brands with none (the
--      platform library was empty) are left unmarked and get a copy the first time their music is listed.
-- RLS: music_tracks keeps ROW LEVEL SECURITY on with no policies (0005, 0011).
ALTER TABLE "music_tracks" ADD COLUMN IF NOT EXISTS "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_tracks_brand_idx" ON "music_tracks" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "music_tracks_brand_r2_key_unique" ON "music_tracks" USING btree ("brand_id","r2_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "music_tracks_platform_r2_key_unique" ON "music_tracks" USING btree ("r2_key") WHERE "brand_id" IS NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "music_tracks_r2_key_unique";--> statement-breakpoint
INSERT INTO "music_tracks" ("workspace_id", "brand_id", "title", "r2_key", "seconds", "bpm", "first_beat", "beat_strength", "loudest_from", "source", "active")
SELECT b."workspace_id", b."id", t."title", t."r2_key", t."seconds", t."bpm", t."first_beat", t."beat_strength", t."loudest_from", t."source", t."active"
FROM "music_tracks" t CROSS JOIN "brands" b
WHERE t."workspace_id" IS NULL AND t."brand_id" IS NULL
ON CONFLICT ("brand_id", "r2_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "music_tracks" ("workspace_id", "brand_id", "title", "r2_key", "seconds", "bpm", "first_beat", "beat_strength", "loudest_from", "source", "active")
SELECT b."workspace_id", b."id", t."title", t."r2_key", t."seconds", t."bpm", t."first_beat", t."beat_strength", t."loudest_from", t."source", t."active"
FROM "music_tracks" t JOIN "brands" b ON b."workspace_id" = t."workspace_id"
WHERE t."workspace_id" IS NOT NULL AND t."brand_id" IS NULL
ON CONFLICT ("brand_id", "r2_key") DO NOTHING;--> statement-breakpoint
UPDATE "brands" SET "settings_json" = COALESCE("settings_json", '{}'::jsonb) || '{"musicSeeded": true}'::jsonb
WHERE EXISTS (SELECT 1 FROM "music_tracks" t WHERE t."brand_id" = "brands"."id")
  AND NOT COALESCE(("settings_json" ->> 'musicSeeded')::boolean, false);--> statement-breakpoint
ALTER TABLE "music_tracks" ENABLE ROW LEVEL SECURITY;
