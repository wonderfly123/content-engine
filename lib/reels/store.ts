/**
 * Instagram Reel review pipeline, local-first.
 *
 * The video skill writes one manifest per job at <jobs>/<job>/_cuts/review.json.
 * The app reads and updates those manifests; the media stays on disk.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ClipNote } from "./clip-notes";
import type { ReelEdits } from "./edits";

export const REEL_STAGES = ["cut_review", "voiceover", "editing", "final_review", "scheduled", "posted"] as const;
export type ReelStage = (typeof REEL_STAGES)[number];

export interface ReelCut {
  id: string;
  title: string;
  seconds: number;
  /** music = no voice-over. voice = has a recorded voice-over (and so gets captions). The editor's suggestion until the reviewer chooses in cut review. */
  mode: "music" | "voice";
  stage: ReelStage;
  /** Paths relative to the job's _cuts folder. */
  preview: string;
  /** The clip list (EDL) the preview was rendered from. With it, the reviewer can edit individual clips in the app. */
  edl?: string;
  /** Set once the reviewer edits clips in the app: `edl` and `preview` are then theirs, and this is what the editor made. */
  original?: { edl: string; preview: string };
  final?: string;
  voiceover?: string;
  /** Draft voice-over script shown while recording. */
  script?: string;
  /** The ready-to-speak script for the AI voice: written once, then only changed by the reviewer (their edits, or Regenerate script). */
  voiceScript?: string;
  /** Post caption (the text under the Reel). */
  caption?: string;
  /** Reviewer's note back to the editor. */
  note?: string;
  /** Reviewer's notes on specific clips, sent back with (or instead of) `note`. Each names the shot and footage it is about. */
  clipNotes?: ClipNote[];
  changesRequested?: boolean;
  /** Light edits from cut review (trim, sections cut out), for the editor to apply. The voice-over is timed to the edited cut. */
  edits?: ReelEdits;
  trial?: "manual" | "auto" | null;
  /** Cover (thumbnail) frame, in seconds into the final video. Suggested by the editor, confirmed by the reviewer. */
  coverAt?: number;
  /** Opening on-screen text: drafts from the editor, the reviewer's pick (made in cut review, changeable in final review), and what is currently in the final file. */
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
  /** Cuts the reviewer deleted in the app. Kept here (and their files left on disk) so a delete can be undone by hand. */
  deleted?: ReelCut[];
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

/** The job's footage folder; clip lists name their source files relative to it. */
export function jobDir(job: string): string {
  if (!SAFE_NAME.test(job)) throw new Error("invalid job name");
  return path.join(jobsDir(), job);
}

/**
 * Resolve a clip's source file. Paths are relative to the job folder, and a cut may borrow footage from another job
 * (`../turf/footage/x.mov`) or a shared folder beside the jobs (`../../generic-build/x.mov`), so anything inside the
 * video library (the folder that holds `jobs`) is allowed. Anything outside it, or in a `.trash`, is refused.
 */
export function resolveInJob(job: string, relative: string): string {
  const library = path.dirname(jobsDir());
  const full = path.resolve(jobDir(job), relative);
  if (!full.startsWith(library + path.sep)) throw new Error("path escapes the video library");
  if (path.relative(library, full).split(path.sep).some((part) => part === ".trash")) throw new Error("path is in the trash");
  return full;
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

/** One change to a job's manifest at a time, so two saves close together (a script being written, the reviewer typing) cannot overwrite each other. */
const queues = new Map<string, Promise<unknown>>();
function inTurn<T>(job: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(job) ?? Promise.resolve()).then(work, work);
  queues.set(job, next.catch(() => undefined));
  return next;
}

export function updateCut(job: string, id: string, change: (cut: ReelCut) => void): Promise<ReelCutView> {
  return inTurn(job, async () => {
    const m = await readManifest(job);
    const cut = m?.cuts.find((c) => c.id === id);
    if (!m || !cut) throw new Error(`cut ${job}/${id} not found`);
    change(cut);
    cut.updatedAt = new Date().toISOString();
    await writeManifest(m);
    return { ...cut, job: m.job, brand: m.brand };
  });
}

/** Takes a cut out of review. Nothing is erased: the entry moves to the manifest's `deleted` list and its files stay on disk. */
export async function deleteCut(job: string, id: string, allowed: readonly ReelStage[]): Promise<void> {
  const m = await readManifest(job);
  const cut = m?.cuts.find((c) => c.id === id);
  if (!m || !cut) throw new Error(`cut ${job}/${id} not found`);
  if (!allowed.includes(cut.stage)) throw new Error("this cut is not waiting for review");
  cut.updatedAt = new Date().toISOString();
  m.cuts = m.cuts.filter((c) => c !== cut);
  m.deleted = [...(m.deleted ?? []), cut];
  await writeManifest(m);
}
