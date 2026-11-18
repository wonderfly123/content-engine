/**
 * Imports the owner's music folder into the editor's built-in library: uploads each track listed in
 * the folder's index.tsv to R2 (music/library/...) and records it in music_tracks with its beat data.
 * Safe to run again: tracks already imported are updated, not duplicated.
 *
 *   npx tsx --env-file=.env.local scripts/import-music.ts [folder]   (default ~/Desktop/ai-video-editing/music)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { db, schema } from "@/lib/db";
import { musicKey, parseMusicIndex, trackTitle } from "@/lib/music/library";
import { headObject, presignPut } from "@/lib/storage/r2";

const TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav" };

async function main() {
  const folder = resolve(process.argv[2] ?? join(homedir(), "Desktop/ai-video-editing/music"));
  const rows = parseMusicIndex(readFileSync(join(folder, "index.tsv"), "utf8"));
  let uploaded = 0;
  for (const row of rows) {
    const file = resolve(folder, row.path);
    if (!file.startsWith(folder + "/")) continue;
    const key = musicKey(row.path);
    const body = readFileSync(file);
    const head = await headObject(key);
    if (!head || head.size !== body.length) {
      const res = await fetch(presignPut(key, 600), {
        method: "PUT",
        body,
        headers: { "Content-Type": TYPES[row.path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" },
      });
      if (!res.ok) throw new Error(`Upload failed for ${row.path} (HTTP ${res.status})`);
      uploaded++;
    }
    const values = {
      title: trackTitle(row.path),
      r2Key: key,
      seconds: row.seconds,
      bpm: row.bpm,
      firstBeat: row.firstBeat,
      beatStrength: row.beatStrength,
      loudestFrom: row.loudestFrom,
      source: `ai-video-editing/music/${row.path.split("/")[0]}`,
    };
    await db.insert(schema.musicTracks).values(values).onConflictDoUpdate({ target: schema.musicTracks.r2Key, set: values });
  }
  console.log(`${rows.length} tracks in the library (${uploaded} uploaded, ${rows.length - uploaded} already on R2).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
