/**
 * The job contract with the editor worker (workers/editor on Modal), checked with zod. Everything
 * the worker sends is untrusted until it passes these shapes and the checks in ./callback.ts.
 */
import { z } from "zod";

const text = (max: number) => z.string().max(max);

export const edlEntrySchema = z.object({
  mediaId: z.string().uuid(),
  in: z.number().nonnegative(),
  dur: z.number().positive(),
  // Same limits as the worker (workers/editor/contract.py): a fast pan can be sped up a lot.
  speed: z.number().positive().max(500),
  cropX: z.number().nullable(),
});

/** Same limits as the worker (MAX_TRACKS, MAX_MUSIC_START in workers/editor/contract.py). */
export const MAX_MUSIC_TRACKS = 200;
export const MAX_MUSIC_START = 3600;

/**
 * A track the editor brought in from the brand's Epidemic Sound account for this job: the file it
 * uploaded beside the previews, and what Epidemic Sound calls it. The callback adds it to the
 * brand's library (lib/music/library.ts addEpidemicTrack).
 */
export const newTrackSchema = z.object({
  key: text(1024).min(1),
  recordingId: z.string().uuid(),
  title: text(200).min(1),
  seconds: z.number().positive().max(3600),
  bpm: z.number().positive().max(400).nullable().optional(),
});
export type WorkerNewTrack = z.infer<typeof newTrackSchema>;

/**
 * The cut's music from the worker: the track (an id from the job's library, or a `newTrack` from
 * Epidemic Sound, never both) and where in it the preview's sound starts; `silent` is the same cut
 * without music, uploaded beside the preview.
 */
export const cutMusicSchema = z
  .object({
    trackId: z.string().uuid().optional(),
    newTrack: newTrackSchema.optional(),
    start: z.number().nonnegative().max(MAX_MUSIC_START),
    silent: z.object({ key: text(1024).min(1) }),
  })
  .refine((m) => Boolean(m.trackId) !== Boolean(m.newTrack), { message: "music needs a trackId or a newTrack, not both" });

export const cutSchema = z.object({
  id: text(100).min(1),
  title: text(3000),
  seconds: z.number().nonnegative().max(60 * 60),
  mode: z.enum(["music", "voice"]),
  preview: z.object({ key: text(1024).min(1) }),
  edl: z.array(edlEntrySchema).max(500),
  hookOptions: z.array(text(500)).max(20),
  caption: text(5000),
  script: text(20000).nullable(),
  coverAt: z.number().nonnegative(),
  // Null (or absent, from a worker before music) for a silent cut.
  music: cutMusicSchema.nullable().optional(),
});

export const manifestSchema = z.object({ cuts: z.array(cutSchema).min(1).max(10) });

export const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().max(100_000),
  turns: z.number().int().nonnegative(),
  seconds: z.number().nonnegative(),
});

export const callbackSchema = z.object({
  jobId: z.string().uuid(),
  ok: z.boolean(),
  error: text(4000).nullable().optional(),
  manifest: manifestSchema.nullable().optional(),
  reply: text(4000).default(""),
  question: text(2000).nullable().optional(),
  usage: usageSchema.nullable().optional(),
});

/** Ten cuts, each with a copy without music, and the tracks brought in from Epidemic Sound (MAX_DOWNLOADS in workers/editor/epidemic.py). */
export const MAX_UPLOAD_FILES = 24;
export const UPLOAD_TYPES = ["video/mp4", "image/jpeg", "audio/mpeg"] as const;

export const uploadsRequestSchema = z.object({
  files: z
    .array(z.object({ name: text(255).min(1), contentType: z.enum(UPLOAD_TYPES) }))
    .min(1)
    .max(MAX_UPLOAD_FILES),
});

export type EditorCallback = z.infer<typeof callbackSchema>;
export type EditorUsage = z.infer<typeof usageSchema>;
export type WorkerCut = z.infer<typeof cutSchema>;
export type WorkerManifest = z.infer<typeof manifestSchema>;

/** A cut's music as stored: the track's title (when the cut was made) and the silent copy's media row id added. */
export interface StoredCutMusic {
  trackId: string;
  title: string;
  start: number;
  silent: { key: string; mediaId: string };
}

/** A cut as stored: the worker's cut, with the preview's media row id added. */
export type EditorCut = Omit<WorkerCut, "preview" | "music"> & { preview: { key: string; mediaId: string }; music?: StoredCutMusic | null };
export interface EditorManifest {
  cuts: EditorCut[];
}
