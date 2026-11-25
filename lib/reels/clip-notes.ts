/**
 * Revision notes pinned to clips: when a cut is sent back, each note names the shot it is about (and optionally a section
 * of it), so the editor changes that shot and leaves the rest of the cut alone.
 * Pure helpers shared by the review screens and the API. No node imports: this file is bundled for the browser.
 */
import { clipStarts, outSeconds, type Clip } from "./clips";

export const MAX_CLIP_NOTES = 50;
export const MAX_CLIP_NOTE_TEXT = 500;
/** Shortest section a note can cover, in cut seconds. */
export const MIN_NOTE_SECONDS = 0.1;

/** A note as the reviewer writes it: which clip, and the part of the cut it covers. */
export interface ClipNoteDraft {
  /** Position of the clip in the cut, counting from 1. */
  clip: number;
  /** The section the note is about, in seconds into the cut. The whole clip when it spans the clip. */
  from: number;
  to: number;
  text: string;
}

/** A note as saved on the cut in review.json, with everything the editor needs to find the footage. */
export interface ClipNote {
  /** Position of the clip in the cut's clip list (`edl`) when the note was written, counting from 1. */
  clip: number;
  /** The clip's source file, relative to the job folder. */
  file: string;
  /** The section the note is about, in seconds into the source file. */
  from: number;
  to: number;
  /** The same section in seconds into the cut. */
  at: number;
  until: number;
  /** True when the note is about the whole clip rather than a section of it. */
  whole: boolean;
  text: string;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
/** Ends within this many cut seconds of a clip's edge count as the edge. */
const EDGE = 0.05;

/** Turns the reviewer's notes into saved notes against `clips` (the cut's clip list). Throws when a note does not fit the cut. */
export function pinClipNotes(clips: Clip[], drafts: ClipNoteDraft[]): ClipNote[] {
  if (drafts.length > MAX_CLIP_NOTES) throw new Error("too many clip notes");
  const starts = clipStarts(clips);
  const notes = drafts.map((d): ClipNote => {
    const clip = clips[d.clip - 1];
    const text = d.text.trim();
    if (!Number.isInteger(d.clip) || !clip) throw new Error(`clip ${d.clip} is not in this cut`);
    if (!text) throw new Error(`the note on clip ${d.clip} is empty`);
    if (text.length > MAX_CLIP_NOTE_TEXT) throw new Error(`the note on clip ${d.clip} is too long`);
    if (!Number.isFinite(d.from) || !Number.isFinite(d.to)) throw new Error(`the note on clip ${d.clip} has no section`);
    const start = starts[d.clip - 1];
    const end = start + outSeconds(clip);
    let at = clamp(d.from, start, end);
    let until = clamp(d.to, start, end);
    if (at - start <= EDGE) at = start;
    if (end - until <= EDGE) until = end;
    if (until - at < Math.min(MIN_NOTE_SECONDS, end - start)) throw new Error(`the section on clip ${d.clip} is too short`);
    return {
      clip: d.clip,
      file: clip.file,
      from: round(clip.in + (at - start) * clip.speed),
      to: round(clip.in + (until - start) * clip.speed),
      at: round(at),
      until: round(until),
      whole: at === start && until === end,
      text,
    };
  });
  return notes.sort((a, b) => a.clip - b.clip || a.at - b.at);
}

/** Most overall notes that can wait on one cut. */
export const MAX_OVERALL_NOTES = 20;

/** The overall notes waiting on a cut. `note` holds one per line, so each send-back adds a line. */
export function overallNotes(note: string | undefined): string[] {
  return (note ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Adds an overall note to the ones already waiting on the cut. Nothing asked for earlier is lost, and the same note is not kept twice. */
export function addOverallNote(pending: string | undefined, note: string | undefined): string {
  const lines = overallNotes(pending);
  const added = (note ?? "").replace(/\s*\n\s*/g, " ").trim();
  if (added && !lines.includes(added)) lines.push(added);
  if (lines.length > MAX_OVERALL_NOTES) throw new Error("too many notes are waiting on this cut");
  return lines.join("\n");
}

/** Adds clip notes to the ones already waiting on the cut, the same way. */
export function addClipNotes(pending: ClipNote[], added: ClipNote[]): ClipNote[] {
  const all = [...pending];
  for (const n of added) {
    if (!all.some((p) => p.file === n.file && p.from === n.from && p.to === n.to && p.text === n.text)) all.push(n);
  }
  if (all.length > MAX_CLIP_NOTES) throw new Error("too many clip notes are waiting on this cut");
  return all.sort((a, b) => a.clip - b.clip || a.at - b.at);
}

/** "Clip 7" for a whole clip, "Clip 7, 12.9s to 13.4s" for a section of it. */
export function clipNoteLabel(note: Pick<ClipNote, "clip" | "at" | "until" | "whole">): string {
  return note.whole ? `Clip ${note.clip}` : `Clip ${note.clip}, ${note.at.toFixed(1)}s to ${note.until.toFixed(1)}s`;
}
