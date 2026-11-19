/**
 * The editor's built-in music library: platform-level tracks on R2 (`music/library/...`), listed and
 * switched on or off in Admin > Music (a track may instead belong to one workspace; see usableBy). Imported from the owner's music folder by
 * scripts/import-music.ts, which reads that folder's index.tsv (tempo, first beat, beat strength,
 * loudest 15 s) so the editor can cut on the beat.
 */
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const { musicTracks } = schema;

/** The most tracks one editor job carries (same as MAX_TRACKS in workers/editor/contract.py). */
export const MAX_JOB_TRACKS = 200;

/** A track the workspace's editor may use: the platform's (no workspace) or the workspace's own. */
const usableBy = (workspaceId: string) => or(isNull(musicTracks.workspaceId), eq(musicTracks.workspaceId, workspaceId));

/** The active tracks an editor job for this workspace gets (platform library plus its own), at most MAX_JOB_TRACKS. */
export async function tracksForWorkspace(workspaceId: string): Promise<MusicTrack[]> {
  return db
    .select()
    .from(musicTracks)
    .where(and(eq(musicTracks.active, true), usableBy(workspaceId)))
    .orderBy(asc(musicTracks.r2Key))
    .limit(MAX_JOB_TRACKS);
}

/**
 * The named tracks this workspace may use, by id (switched off ones included: a kept cut may still
 * name one). A track of another workspace is never returned.
 */
export async function usableTracks(workspaceId: string, ids: string[]): Promise<Map<string, MusicTrack>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(musicTracks).where(and(inArray(musicTracks.id, ids), usableBy(workspaceId)));
  return new Map(rows.map((t) => [t.id, t]));
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

/** Where an uploaded track goes: music/library/uploads/<id>-<name>. */
export const uploadKey = (id: string, filename: string) => musicKey(`uploads/${id}-${filename.replace(/\//g, "-").replace(/\.{2,}/g, ".")}`);

export type MusicTrack = typeof musicTracks.$inferSelect;

export async function listTracks(o: { activeOnly?: boolean } = {}): Promise<MusicTrack[]> {
  const q = db.select().from(musicTracks);
  return (o.activeOnly ? q.where(eq(musicTracks.active, true)) : q).orderBy(asc(musicTracks.r2Key));
}

/** Records an uploaded track (its file is already on R2 under an uploads/ key). */
export async function addUploadedTrack(t: { key: string; title: string; seconds: number }): Promise<MusicTrack> {
  const [row] = await db
    .insert(musicTracks)
    .values({ title: t.title, r2Key: t.key, seconds: t.seconds, source: "upload" })
    .onConflictDoUpdate({ target: musicTracks.r2Key, set: { title: t.title, seconds: t.seconds } })
    .returning();
  return row;
}

export async function setTrackActive(id: string, active: boolean): Promise<boolean> {
  const rows = await db.update(musicTracks).set({ active }).where(eq(musicTracks.id, id)).returning({ id: musicTracks.id });
  return rows.length > 0;
}
