/**
 * Light edits a reviewer makes on a cut: trim the start and end, and cut sections out.
 * Pure helpers shared by the review screen and the API. All times are seconds into the preview file.
 */

export interface ReelRange {
  from: number;
  to: number;
}

/** What the editor receives: the parts of the preview to keep, in order, and the resulting length. */
export interface ReelEdits {
  keep: ReelRange[];
  seconds: number;
}

/** What the review screen edits: a start, an end (null = the natural end) and the sections cut out. */
export interface TrimState {
  start: number;
  end: number | null;
  removed: ReelRange[];
}

export const NO_TRIM: TrimState = { start: 0, end: null, removed: [] };

/** Shortest piece worth keeping or cutting, in seconds. */
const MIN_PIECE = 0.1;
const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** The parts of the video that remain after the trim, sorted and non-overlapping. */
export function keptRanges(trim: TrimState, duration: number): ReelRange[] {
  const start = clamp(trim.start, 0, duration);
  const end = clamp(trim.end ?? duration, start, duration);
  const removed = trim.removed
    .map((r) => ({ from: clamp(Math.min(r.from, r.to), start, end), to: clamp(Math.max(r.from, r.to), start, end) }))
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from);
  const keep: ReelRange[] = [];
  let at = start;
  for (const r of removed) {
    if (r.from - at >= MIN_PIECE) keep.push({ from: round(at), to: round(r.from) });
    at = Math.max(at, r.to);
  }
  if (end - at >= MIN_PIECE) keep.push({ from: round(at), to: round(end) });
  return keep;
}

export function keptSeconds(keep: ReelRange[]): number {
  return round(keep.reduce((sum, k) => sum + (k.to - k.from), 0));
}

/** False when the kept ranges are simply the whole video. */
export function isEdited(keep: ReelRange[], duration: number): boolean {
  return !(keep.length === 1 && keep[0].from < MIN_PIECE && duration - keep[0].to < MIN_PIECE);
}

/** Rebuilds the review screen's state from saved edits. */
export function trimFromKeep(keep: ReelRange[]): TrimState {
  if (keep.length === 0) return NO_TRIM;
  const removed: ReelRange[] = [];
  for (let i = 1; i < keep.length; i++) removed.push({ from: keep[i - 1].to, to: keep[i].from });
  return { start: keep[0].from, end: keep[keep.length - 1].to, removed };
}

/** Where playback should be at time t: t itself inside a kept range, the start of the next one otherwise, null past the end. */
export function playableAt(keep: ReelRange[], t: number): number | null {
  for (const k of keep) {
    if (t < k.to - 0.02) return Math.max(t, k.from);
  }
  return null;
}

/** Kept ranges must be in order, non-overlapping and each longer than nothing. */
export function isValidKeep(keep: ReelRange[]): boolean {
  let at = 0;
  for (const k of keep) {
    if (!(k.from >= at && k.to > k.from)) return false;
    at = k.to;
  }
  return keep.length > 0;
}
