/**
 * The editor's music library, per brand: tracks on R2 (`music/library/...`) that each brand lists,
 * uploads and switches on or off in Settings > Music. A brand starts with a copy of the platform
 * library (rows with no brand and no workspace), imported from the owner's music folder by
 * scripts/import-music.ts, which reads that folder's index.tsv (tempo, first beat, beat strength,
 * loudest 15 s) so the editor can cut on the beat. Several brands' rows may share one R2 object.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const { musicTracks, brands } = schema;

/** The most tracks one editor job carries (same as MAX_TRACKS in workers/editor/contract.py). */
export const MAX_JOB_TRACKS = 200;

export type MusicTrack = typeof musicTracks.$inferSelect;

/** One brand's own tracks (brand and its workspace both match). */
const ownedBy = (brandId: string, workspaceId: string) => and(eq(musicTracks.brandId, brandId), eq(musicTracks.workspaceId, workspaceId));

/**
 * Gives a brand its starting library once: a copy of the platform library, the first time its
 * tracks are listed or an editor job is built. Marked done with `musicSeeded` in the brand's
 * settings in the same transaction (the brand row is locked meanwhile), so a brand that later turns
 * off or loses all its tracks is never refilled. A brand that already has tracks of its own is only
 * marked. While the platform library is empty there is nothing to copy and the brand stays unmarked.
 */
export async function ensureBrandTracks(brandId: string, workspaceId: string): Promise<void> {
  const seeded = async (q: Pick<typeof db, "select">, lock: boolean) => {
    const base = q
      .select({ settings: brands.settingsJson })
      .from(brands)
      .where(and(eq(brands.id, brandId), eq(brands.workspaceId, workspaceId)))
      .limit(1);
    const [row] = lock ? await base.for("update") : await base;
    return row ? row.settings?.musicSeeded === true : null;
  };
  if ((await seeded(db, false)) !== false) return; // done already, or no such brand
  await db.transaction(async (tx) => {
    if ((await seeded(tx, true)) !== false) return;
    const [own] = await tx.select({ id: musicTracks.id }).from(musicTracks).where(eq(musicTracks.brandId, brandId)).limit(1);
    if (!own) {
      const platform = await tx.select().from(musicTracks).where(and(isNull(musicTracks.brandId), isNull(musicTracks.workspaceId)));
      if (platform.length === 0) return;
      await tx
        .insert(musicTracks)
        .values(platform.map(({ id: _id, createdAt: _at, ...t }) => ({ ...t, brandId, workspaceId })))
        .onConflictDoNothing({ target: [musicTracks.brandId, musicTracks.r2Key] });
    }
    await tx
      .update(brands)
      .set({ settingsJson: sql`coalesce(${brands.settingsJson}, '{}'::jsonb) || '{"musicSeeded": true}'::jsonb` })
      .where(eq(brands.id, brandId));
  });
}

/** The active tracks an editor job for this brand gets (its own library only), at most MAX_JOB_TRACKS. */
export async function tracksForBrand(brandId: string, workspaceId: string): Promise<MusicTrack[]> {
  await ensureBrandTracks(brandId, workspaceId);
  return db
    .select()
    .from(musicTracks)
    .where(and(eq(musicTracks.active, true), ownedBy(brandId, workspaceId)))
    .orderBy(asc(musicTracks.r2Key))
    .limit(MAX_JOB_TRACKS);
}

/**
 * The named tracks a job may use, by id (switched off ones included: a kept cut may still name
 * one): the brand's own, plus rows from before libraries were per brand (no brand; the platform's
 * or this workspace's). Another brand's or another workspace's track is never returned. A job with
 * no brand gets only those older rows.
 */
export async function usableTracks(job: { workspaceId: string; brandId: string | null }, ids: string[]): Promise<Map<string, MusicTrack>> {
  if (ids.length === 0) return new Map();
  const legacy = and(isNull(musicTracks.brandId), or(isNull(musicTracks.workspaceId), eq(musicTracks.workspaceId, job.workspaceId)));
  const usable = job.brandId ? or(ownedBy(job.brandId, job.workspaceId), legacy) : legacy;
  const rows = await db.select().from(musicTracks).where(and(inArray(musicTracks.id, ids), usable));
  return new Map(rows.map((t) => [t.id, t]));
}

/** Every track in the brand's library (on and off), for Settings > Music. Seeds a new brand first. */
export async function listBrandTracks(brandId: string, workspaceId: string): Promise<MusicTrack[]> {
  await ensureBrandTracks(brandId, workspaceId);
  return db.select().from(musicTracks).where(ownedBy(brandId, workspaceId)).orderBy(asc(musicTracks.title), asc(musicTracks.r2Key));
}

/** Records a track the brand uploaded (its file is already on R2 under the brand's uploads/ key). */
export async function addBrandTrack(t: { brandId: string; workspaceId: string; key: string; title: string; seconds: number }): Promise<MusicTrack> {
  const [row] = await db
    .insert(musicTracks)
    .values({ brandId: t.brandId, workspaceId: t.workspaceId, title: t.title, r2Key: t.key, seconds: t.seconds, source: "upload" })
    .onConflictDoUpdate({ target: [musicTracks.brandId, musicTracks.r2Key], set: { title: t.title, seconds: t.seconds } })
    .returning();
  return row;
}

/** Turns one of the brand's tracks on or off. False when the brand has no such track. */
export async function setBrandTrackActive(brandId: string, workspaceId: string, id: string, active: boolean): Promise<boolean> {
  const rows = await db
    .update(musicTracks)
    .set({ active })
    .where(and(eq(musicTracks.id, id), ownedBy(brandId, workspaceId)))
    .returning({ id: musicTracks.id });
  return rows.length > 0;
}

export const MUSIC_PREFIX = "music/library/";

export interface IndexRow {
  path: string;
  seconds: number;
  bpm: number | null;
  firstBeat: number | null;
  beatStrength: number | null;
  loudestFrom: number | null;
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** Parses the music folder's index.tsv (header: track, seconds, bpm, first_beat, beat_strength, loudest_15s_from). */
export function parseMusicIndex(tsv: string): IndexRow[] {
  const [header, ...lines] = tsv.split(/\r?\n/).filter((l) => l.trim());
  const cols = (header ?? "").split("\t");
  const at = (name: string) => cols.indexOf(name);
  return lines.flatMap((line) => {
    const v = line.split("\t");
    const path = v[at("track")]?.trim();
    const seconds = num(v[at("seconds")]);
    if (!path || seconds === null || !/\.(mp3|m4a|wav|aac)$/i.test(path) || path.includes("..")) return [];
    return [{ path, seconds, bpm: num(v[at("bpm")]), firstBeat: num(v[at("first_beat")]), beatStrength: num(v[at("beat_strength")]), loudestFrom: num(v[at("loudest_15s_from")]) }];
  });
}

/** R2 key for a track: its folder path, lower-cased and limited to safe characters. */
export const musicKey = (path: string) => MUSIC_PREFIX + path.toLowerCase().replace(/[^a-z0-9/._-]+/g, "-");

/** "trending-11-10-26/07.mp3" -> "Trending 11-10-26 · 07". */
export function trackTitle(path: string): string {
  const parts = path.replace(/\.[a-z0-9]+$/i, "").split("/");
  const name = parts.pop() ?? path;
  const folder = parts.join(" ").replace(/-/g, " ").replace(/\b\w/, (c) => c.toUpperCase());
  return folder ? `${folder.replace(/ (\d\d) (\d\d) (\d\d)$/, " $1-$2-$3")} · ${name}` : name;
}

export const MAX_TRACK_BYTES = 50 * 1024 * 1024;
export const AUDIO_TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav" };
export const audioExtension = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ext in AUDIO_TYPES ? ext : null;
};

const safeName = (filename: string) => filename.replace(/\//g, "-").replace(/\.{2,}/g, ".");

/** Where an uploaded track goes: music/library/uploads/<id>-<name>. */
export const uploadKey = (id: string, filename: string) => musicKey(`uploads/${id}-${safeName(filename)}`);

/** The folder one brand's uploads go to: music/library/uploads/<brand id>/. */
export const brandUploadPrefix = (brandId: string) => musicKey(`uploads/${brandId}/`);

/** Where a brand's uploaded track goes: music/library/uploads/<brand id>/<id>-<name>. */
export const brandUploadKey = (brandId: string, id: string, filename: string) => musicKey(`uploads/${brandId}/${id}-${safeName(filename)}`);

/** True for a key this brand's upload could have been given (under its folder, no "..", nothing deeper). */
export function isBrandUploadKey(brandId: string, key: string): boolean {
  const prefix = brandUploadPrefix(brandId);
  if (!key.startsWith(prefix) || key.includes("..")) return false;
  const rest = key.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/") && musicKey(key.slice(MUSIC_PREFIX.length)) === key;
}
