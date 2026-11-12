/**
 * Instagram Reel review pipeline, local-first.
 *
 * The video skill writes one manifest per job at <jobs>/<job>/_cuts/review.json.
 * The app reads and updates those manifests; the media stays on disk.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const REEL_STAGES = ["cut_review", "voiceover", "editing", "final_review", "scheduled", "posted"] as const;
export type ReelStage = (typeof REEL_STAGES)[number];

export interface ReelCut {
  id: string;
  title: string;
  seconds: number;
  /** music = music-led, no voice-over. voice = voice-led, needs a recorded voice-over. */
  mode: "music" | "voice";
  stage: ReelStage;
  /** Paths relative to the job's _cuts folder. */
  preview: string;
  final?: string;
  voiceover?: string;
  /** Draft voice-over script shown while recording. */
  script?: string;
  /** Post caption (the text under the Reel). */
  caption?: string;
  /** Reviewer's note back to the editor. */
  note?: string;
  changesRequested?: boolean;
  trial?: "manual" | "auto" | null;
  /** Cover (thumbnail) frame, in seconds into the final video. Suggested by the editor, confirmed by the reviewer. */
  coverAt?: number;
  /** Opening on-screen text: drafts from the editor, the reviewer's pick, and what is currently in the final file. */
  hookOptions?: string[];
  hook?: string;
  hookBurned?: string;
  /** Set when the reviewer approved with opening text that is not on the video yet: the editor adds the text, then schedules with exactly these details. */
  approval?: { when: string; mode: "trial-manual" | "trial-auto" | "normal"; coverAt: number };
  scheduledFor?: string;
  postId?: string;
  updatedAt?: string;
}

export interface ReelManifest {
  job: string;
  /** Brand slug this job posts under. */
  brand: string;
  cuts: ReelCut[];
}

export interface ReelCutView extends ReelCut {
  job: string;
  brand: string;
}

export function jobsDir(): string {
  return process.env.VIDEO_JOBS_DIR ?? path.join(os.homedir(), "Desktop", "ai-video-editing", "jobs");
}

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function cutsDir(job: string): string {
  if (!SAFE_NAME.test(job)) throw new Error("invalid job name");
  return path.join(jobsDir(), job, "_cuts");
}

/** Resolve a manifest-relative path, refusing anything that escapes the job's _cuts folder. */
export function resolveInCuts(job: string, relative: string): string {
  const root = cutsDir(job);
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("path escapes the job folder");
  return full;
}

function manifestPath(job: string): string {
  return path.join(cutsDir(job), "review.json");
}

export async function readManifest(job: string): Promise<ReelManifest | null> {
  try {
    return JSON.parse(await fs.readFile(manifestPath(job), "utf8")) as ReelManifest;
  } catch {
    return null;
  }
}

export async function writeManifest(manifest: ReelManifest): Promise<void> {
  const file = manifestPath(manifest.job);
  await fs.writeFile(file + ".tmp", JSON.stringify(manifest, null, 2) + "\n");
  await fs.rename(file + ".tmp", file);
}

export async function listCuts(brandSlug?: string): Promise<ReelCutView[]> {
  let jobs: string[] = [];
  try {
    jobs = (await fs.readdir(jobsDir(), { withFileTypes: true })).filter((d) => d.isDirectory() && SAFE_NAME.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  const out: ReelCutView[] = [];
  for (const job of jobs) {
    const m = await readManifest(job);
    if (!m || (brandSlug && m.brand !== brandSlug)) continue;
    for (const cut of m.cuts) out.push({ ...cut, job: m.job, brand: m.brand });
  }
  return out;
}

export async function updateCut(job: string, id: string, change: (cut: ReelCut) => void): Promise<ReelCutView> {
  const m = await readManifest(job);
  const cut = m?.cuts.find((c) => c.id === id);
  if (!m || !cut) throw new Error(`cut ${job}/${id} not found`);
  change(cut);
  cut.updatedAt = new Date().toISOString();
  await writeManifest(m);
  return { ...cut, job: m.job, brand: m.brand };
}
