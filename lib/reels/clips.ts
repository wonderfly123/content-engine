/**
 * A cut as a list of clips (the video skill's EDL: one shot per line, `file|in|source_seconds|speed|crop_x`).
 * Pure helpers shared by the clip editor and the API. No node imports: this file is bundled for the browser.
 */

export interface Clip {
  /** Source file, relative to the job folder. */
  file: string;
  /** Where the shot starts in the source, in seconds. */
  in: number;
  /** How much of the source is used, in seconds. */
  dur: number;
  /** Playback speed (1 = real time, 60 = timelapse). */
  speed: number;
  /** Horizontal crop position 0-1 for landscape sources. */
  cropX?: number;
}

/** A clip in the editor: a stable key for React and drags, and the length of its source file. */
export interface EditorClip extends Clip {
  key: string;
  max: number;
}

/** Shortest a clip may be on the timeline, in seconds. */
export const MIN_OUT = 0.2;
export const MAX_CLIPS = 200;
export const MAX_TOTAL_SECONDS = 180;

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export function parseEdl(text: string): Clip[] {
  const clips: Clip[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [file, start, dur, speed, cropX] = line.split("|");
    if (!file?.trim() || start === undefined || dur === undefined) continue;
    const clip: Clip = { file: file.trim(), in: Number(start), dur: Number(dur), speed: Number(speed ?? 1) || 1 };
    if (cropX !== undefined && cropX.trim() !== "") clip.cropX = Number(cropX);
    if ([clip.in, clip.dur, clip.speed].every(Number.isFinite) && clip.dur > 0 && clip.speed > 0) clips.push(clip);
  }
  return clips;
}

export function formatEdl(clips: Clip[]): string {
  return clips.map((c) => [c.file, round(c.in), round(c.dur), round(c.speed), ...(c.cropX === undefined ? [] : [round(c.cropX)])].join("|")).join("\n") + "\n";
}

/** Length of a clip on the timeline. */
export const outSeconds = (c: Clip) => c.dur / c.speed;

export function totalSeconds(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + outSeconds(c), 0);
}

/** Timeline start of every clip. */
export function clipStarts(clips: Clip[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const c of clips) { starts.push(at); at += outSeconds(c); }
  return starts;
}

/** Which clip is on screen at timeline time t, and how far into it (timeline seconds). Past the end, the last frame. */
export function clipAt(clips: Clip[], t: number): { index: number; offset: number } | null {
  if (clips.length === 0) return null;
  let at = 0;
  for (let i = 0; i < clips.length; i++) {
    const len = outSeconds(clips[i]);
    if (t < at + len || i === clips.length - 1) return { index: i, offset: clamp(t - at, 0, len) };
    at += len;
  }
  return null;
}

/** Move the left edge by `deltaOut` timeline seconds: positive trims the start, negative extends into earlier footage. */
export function trimLeft<T extends Clip>(clip: T, deltaOut: number): T {
  const d = clamp(deltaOut * clip.speed, -clip.in, clip.dur - MIN_OUT * clip.speed);
  return { ...clip, in: round(clip.in + d), dur: round(clip.dur - d) };
}

/** Move the right edge by `deltaOut` timeline seconds: positive extends into later footage (up to `max`), negative trims. */
export function trimRight<T extends Clip>(clip: T, deltaOut: number, max: number): T {
  const dur = clamp(clip.dur + deltaOut * clip.speed, Math.min(MIN_OUT * clip.speed, clip.dur), Math.max(max - clip.in, clip.dur));
  return { ...clip, dur: round(dur) };
}

/** Split the clip under timeline time t in two. Returns the same list when t is too close to an edge. */
export function splitAt(clips: EditorClip[], t: number, newKey: string): EditorClip[] {
  const hit = clipAt(clips, t);
  if (!hit) return clips;
  const clip = clips[hit.index];
  if (hit.offset < MIN_OUT || outSeconds(clip) - hit.offset < MIN_OUT) return clips;
  const used = round(hit.offset * clip.speed);
  const first: EditorClip = { ...clip, dur: used };
  const second: EditorClip = { ...clip, key: newKey, in: round(clip.in + used), dur: round(clip.dur - used) };
  return [...clips.slice(0, hit.index), first, second, ...clips.slice(hit.index + 1)];
}

/** Move a clip to sit before the clip currently at `to` (to = length puts it last). */
export function moveClip<T>(clips: T[], from: number, to: number): T[] {
  if (from < 0 || from >= clips.length) return clips;
  const next = clips.slice();
  const [item] = next.splice(from, 1);
  next.splice(clamp(to > from ? to - 1 : to, 0, next.length), 0, item);
  return next;
}

/** A copy of the clip at `index`, placed right after it. */
export function duplicateClip(clips: EditorClip[], index: number, newKey: string): EditorClip[] {
  if (!clips[index]) return clips;
  return [...clips.slice(0, index + 1), { ...clips[index], key: newKey }, ...clips.slice(index + 1)];
}

/** A clip on the top lane: it sits over the cut at `at` (timeline seconds) and is what shows on screen for its length. */
export interface OverClip extends EditorClip {
  at: number;
}

/** The editor's whole state: the cut itself, and any clips laid over it on the top lane. */
export interface CutState {
  main: EditorClip[];
  over: OverClip[];
}

/** Pieces shorter than this (under a frame) are dropped when a top clip cuts into the clips under it. */
const SLIVER = 0.02;

/**
 * Puts a top-lane clip into the cut: whatever it covers is cut away (clips it only partly covers are trimmed or split
 * around it), so the cut keeps its length. `newKey` names the right-hand piece of a clip that gets split.
 */
export function overlayInto(main: EditorClip[], top: OverClip, newKey: (base: string) => string): EditorClip[] {
  const { at, ...clip } = top;
  const a = clamp(at, 0, totalSeconds(main));
  const b = a + outSeconds(clip);
  const out: EditorClip[] = [];
  let placed = false;
  const place = () => { if (!placed) { out.push(clip); placed = true; } };
  let s = 0;
  for (const c of main) {
    const e = s + outSeconds(c);
    if (e <= a + SLIVER) out.push(c);
    else if (s >= b - SLIVER) { place(); out.push(c); }
    else {
      if (a - s > SLIVER) out.push({ ...c, dur: round((a - s) * c.speed) });
      place();
      if (e - b > SLIVER) out.push({ ...c, key: newKey(c.key), in: round(c.in + (b - s) * c.speed), dur: round((e - b) * c.speed) });
    }
    s = e;
  }
  place();
  return out;
}

/** The cut as it plays and renders: every top-lane clip put into the cut, later ones over earlier ones. */
export function flatten(state: CutState): EditorClip[] {
  let n = 0;
  return state.over.reduce((main, top) => overlayInto(main, top, (base) => `${base}~${n++}`), state.main);
}

/** The nearest of `targets` to t when it is within `tolerance`, otherwise t. */
export function snapTo(t: number, targets: number[], tolerance: number): number {
  let best = t;
  let gap = tolerance;
  for (const target of targets) {
    if (Math.abs(target - t) <= gap) { best = target; gap = Math.abs(target - t); }
  }
  return best;
}

/** Why a clip list cannot be saved, or null when it is fine. `maxOf` gives the length of a source file. */
export function clipsProblem(clips: Clip[], maxOf: (file: string) => number | undefined): string | null {
  if (clips.length === 0) return "the cut has no clips";
  if (clips.length > MAX_CLIPS) return "too many clips";
  for (const c of clips) {
    const max = maxOf(c.file);
    if (max === undefined) return `${c.file} is not footage of this job`;
    if (!(c.speed > 0 && c.speed <= 2000)) return "invalid speed";
    if (!(c.in >= 0 && c.dur > 0 && c.in + c.dur <= max + 0.1)) return `${c.file} runs past the end of its footage`;
    if (c.cropX !== undefined && !(c.cropX >= 0 && c.cropX <= 1)) return "invalid crop";
  }
  if (totalSeconds(clips) > MAX_TOTAL_SECONDS) return "the cut is longer than 3 minutes";
  return null;
}
