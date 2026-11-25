"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { MAX_CLIP_NOTES, MAX_CLIP_NOTE_TEXT, clipNoteLabel, overallNotes, type ClipNoteDraft } from "@/lib/reels/clip-notes";
import { clipAt, clipStarts, outSeconds, type Clip } from "@/lib/reels/clips";
import type { ReelCutView } from "@/lib/reels/store";
import { patch } from "./shared";

/** One-tap notes for the changes asked for most. */
const QUICK = [
  { label: "Shorter", text: "Make this shorter" },
  { label: "Longer", text: "Hold this longer" },
  { label: "Swap shot", text: "Swap this for a different shot" },
  { label: "Remove", text: "Remove this" },
] as const;

/** A section this close to both edges of its clip is the whole clip. */
const EDGE = 0.05;

interface ClipNotesProps {
  cut: ReelCutView;
  /** The player showing the cut: picking a clip or dragging a section moves it there. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  notes: ClipNoteDraft[];
  onChange: (notes: ClipNoteDraft[]) => void;
  disabled?: boolean;
}

/**
 * Notes for the editor pinned to clips of the cut. Pick a clip from the strip (or the one playing now), narrow it to a
 * section if the note is about part of it, then tap a quick note or write one. Nothing is sent from here: the notes go
 * with "Send back".
 */
export function ClipNotes({ cut, videoRef, notes, onChange, disabled }: ClipNotesProps) {
  const clipsQ = useQuery({
    queryKey: ["reel-clip-list", cut.job, cut.id, cut.edl],
    queryFn: async () => {
      const res = await fetch(`/api/reels/clips?job=${encodeURIComponent(cut.job)}&id=${encodeURIComponent(cut.id)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { clips?: Clip[]; error?: string };
      if (!res.ok || !body.clips) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body.clips;
    },
    staleTime: Infinity,
  });
  const clips = useMemo(() => clipsQ.data ?? [], [clipsQ.data]);
  const starts = useMemo(() => clipStarts(clips), [clips]);

  // The clip on screen in the player, outlined in the strip.
  const [time, setTime] = useState(0);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tick = () => setTime(video.currentTime);
    video.addEventListener("timeupdate", tick);
    video.addEventListener("seeked", tick);
    return () => { video.removeEventListener("timeupdate", tick); video.removeEventListener("seeked", tick); };
  }, [videoRef, cut.preview, cut.final]);
  const playing = clipAt(clips, time)?.index ?? -1;

  const [selected, setSelected] = useState<number | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [text, setText] = useState("");
  const seek = (t: number) => { const video = videoRef.current; if (video) { video.pause(); video.currentTime = t; } };
  const select = (index: number) => {
    const start = starts[index];
    setSelected(index);
    setRange([start, start + outSeconds(clips[index])]);
    seek(start + 0.01);
  };

  if (clipsQ.isError) return <p className="text-xs text-muted-foreground">Notes on single clips are not available for this cut ({(clipsQ.error as Error).message}). Use the overall note.</p>;
  if (!clipsQ.data) return <p className="text-xs text-muted-foreground">Loading the clips…</p>;

  const start = selected === null ? 0 : starts[selected];
  const end = selected === null ? 0 : start + outSeconds(clips[selected]);
  const whole = range[0] - start <= EDGE && end - range[1] <= EDGE;
  const full = notes.length >= MAX_CLIP_NOTES;
  const add = (noteText: string) => {
    if (selected === null || !noteText.trim() || full) return;
    onChange([...notes, { clip: selected + 1, from: whole ? start : range[0], to: whole ? end : range[1], text: noteText.trim() }]);
    setText("");
  };
  const thumb = (c: Clip) => `/api/reels/thumb?job=${encodeURIComponent(cut.job)}&file=${encodeURIComponent(c.file)}&t=${(Math.round((c.in + c.dur / 2) * 2) / 2).toFixed(1)}`;
  const labelOf = (n: ClipNoteDraft) => {
    const s = starts[n.clip - 1] ?? 0;
    const e = s + (clips[n.clip - 1] ? outSeconds(clips[n.clip - 1]) : 0);
    return clipNoteLabel({ clip: n.clip, at: n.from, until: n.to, whole: n.from - s <= EDGE && e - n.to <= EDGE });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">Pick the clip a note is about.</p>
        <Button size="sm" variant="outline" disabled={disabled || playing < 0} onClick={() => select(playing)}>
          <MapPin className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Clip playing now
        </Button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto p-1" role="listbox" aria-label="Clips in this cut">
        {clips.map((c, i) => {
          const count = notes.filter((n) => n.clip === i + 1).length;
          return (
            <button key={i} type="button" role="option" aria-selected={selected === i} aria-label={`Clip ${i + 1}${count ? `, ${count} note${count > 1 ? "s" : ""}` : ""}`} disabled={disabled} onClick={() => select(i)}
              className={`relative aspect-[9/16] w-11 shrink-0 overflow-hidden rounded-md border-2 bg-muted ${selected === i ? "border-orange-500 ring-2 ring-orange-500/50" : playing === i ? "border-foreground/40" : "border-transparent opacity-80"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb(c)} alt="" loading="lazy" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] leading-4 text-white tabular-nums">{i + 1}</span>
              {count > 0 && <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">{count}</span>}
            </button>
          );
        })}
      </div>

      {selected !== null && (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <p className="text-sm">
            <span className="font-medium">Clip {selected + 1}</span>
            <span className="text-muted-foreground tabular-nums"> · {whole ? `whole clip, ${start.toFixed(1)}s to ${end.toFixed(1)}s` : `only ${range[0].toFixed(1)}s to ${range[1].toFixed(1)}s`}</span>
          </p>
          {end - start >= 0.4 && (
            <>
              <Slider min={start} max={end} step={0.05} minStepsBetweenThumbs={4} value={range} disabled={disabled} aria-label="Section of the clip"
                onValueChange={(v) => {
                  const next: [number, number] = [v[0], v[1]];
                  // Show the frame under the handle being dragged.
                  seek(next[0] !== range[0] ? next[0] : Math.max(next[1] - 0.03, start));
                  setRange(next);
                }} />
              <p className="text-xs text-muted-foreground">Drag the ends to point at one part of the clip. Leave them alone for the whole clip.</p>
            </>
          )}
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <Button key={q.label} size="sm" variant="outline" disabled={disabled || full} onClick={() => add(q.text)}>{q.label}</Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(text); } }}
              maxLength={MAX_CLIP_NOTE_TEXT} placeholder="Or write what should change here" aria-label={`Note on clip ${selected + 1}`} disabled={disabled} />
            <Button variant="outline" disabled={disabled || full || !text.trim()} onClick={() => add(text)}>Add note</Button>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2 rounded-md bg-muted/60 px-2 py-1 text-sm">
              <button type="button" className="shrink-0 font-medium tabular-nums hover:underline" disabled={disabled} onClick={() => { setSelected(n.clip - 1); setRange([n.from, n.to]); seek(n.from + 0.01); }}>{labelOf(n)}</button>
              <span className="min-w-0 flex-1 break-words">{n.text}</span>
              <button type="button" aria-label={`Remove the note on clip ${n.clip}`} disabled={disabled} onClick={() => onChange(notes.filter((_, j) => j !== i))} className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Everything waiting on the editor for a cut that was sent back: the overall notes and each clip note. Sending back again
 * adds to this list, and a note can be taken back here before the editor gets to it.
 */
export function RequestedChanges({ cut }: { cut: ReelCutView }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (note: { kind: "overall" | "clip"; index: number; text: string }) => patch({ job: cut.job, id: cut.id, action: "remove_note", remove: note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reels"] }),
    onError: (e) => { toast.error((e as Error).message); void qc.invalidateQueries({ queryKey: ["reels"] }); },
  });
  const overall = overallNotes(cut.note);
  const clipNotes = cut.clipNotes ?? [];
  if (!cut.changesRequested || (overall.length === 0 && clipNotes.length === 0)) return null;
  const row = (kind: "overall" | "clip", index: number, text: string, label?: string) => (
    <li key={`${kind}-${index}`} className="flex items-start gap-2">
      <span className="min-w-0 flex-1 break-words">{label && <span className="font-medium tabular-nums">{label}: </span>}{text}</span>
      <button type="button" aria-label={`Remove the note "${text}"`} disabled={remove.isPending} onClick={() => remove.mutate({ kind, index, text })} className="shrink-0 hover:text-foreground">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
  return (
    <div className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Waiting on changes</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {overall.map((text, i) => row("overall", i, text))}
        {clipNotes.map((n, i) => row("clip", i, n.text, clipNoteLabel(n)))}
      </ul>
      <p className="mt-1 text-xs">Anything you send back now is added to this list.</p>
    </div>
  );
}
