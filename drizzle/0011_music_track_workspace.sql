-- Music in the cloud editor's cuts: a track can belong to one workspace (null = the platform library every
-- workspace's editor may use). The editor only gets, and the callback only accepts, tracks that are the
-- platform's or the job's own workspace's. Hand-written to match musicTracks in lib/db/schema-media.ts.
-- Purely additive: one nullable column and an index; every existing track stays platform-wide.
-- RLS: music_tracks already has ROW LEVEL SECURITY on with no policies (0005); nothing here changes that.
ALTER TABLE "music_tracks" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_tracks_workspace_idx" ON "music_tracks" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "music_tracks" ENABLE ROW LEVEL SECURITY;
