"use client";

import { useState } from "react";
import { Scissors, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NO_TRIM, isEdited, keptSeconds, type ReelRange, type TrimState } from "@/lib/reels/edits";

const fmt = (t: number) => `${t.toFixed(1)}s`;

interface TrimEditorProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  time: number;
  duration: number;
  /** What remains after the trim, from useEditedPlayback. */
  keep: ReelRange[];
  trim: TrimState;
  onChange: (trim: TrimState) => void;
  /** Set while a voice-over take exists or is being recorded: the take is timed to the current edit. */
  locked?: boolean;
}

/** Light editing under the player: move the start and end, and cut sections out of the middle. */
export function TrimEditor({ videoRef, time, duration, keep, trim, onChange, locked }: TrimEditorProps) {
  // First half of "cut a section out": where the section starts.
  const [mark, setMark] = useState<number | null>(null);
  if (duration <= 0) return <p className="text-xs text-muted-foreground">Loading the video…</p>;

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const edited = isEdited(keep, duration);
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (videoRef.current) videoRef.current.currentTime = ((e.clientX - box.left) / box.width) * duration;
  };
  const cutSection = () => {
    if (mark === null) { setMark(time); return; }
    if (Math.abs(time - mark) >= 0.1) onChange({ ...trim, removed: [...trim.removed, { from: Math.min(mark, time), to: Math.max(mark, time) }] });
    setMark(null);
  };
  // Sections cut out of the middle, as they ended up after merging.
  const gaps = keep.slice(1).map((k, i) => ({ from: keep[i].to, to: k.from }));
  const restore = (gap: ReelRange) =>
    onChange({ ...trim, removed: trim.removed.filter((r) => Math.max(r.from, r.to) <= gap.from || Math.min(r.from, r.to) >= gap.to) });

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-7 cursor-pointer overflow-hidden rounded-md bg-muted" onClick={seek} role="presentation">
        {keep.map((k) => (
          <div key={k.from} className="absolute inset-y-0 bg-primary/40" style={{ left: pct(k.from), width: pct(k.to - k.from) }} />
        ))}
        {mark !== null && (
          <div className="absolute inset-y-0 bg-destructive/50" style={{ left: pct(Math.min(mark, time)), width: pct(Math.abs(time - mark)) }} />
        )}
        <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: pct(time) }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {keep.length === 0
          ? "Nothing is left of the video. Reset and try again."
          : edited ? `New length ${fmt(keptSeconds(keep))} of ${fmt(duration)}. It plays the way it will be cut.` : `${fmt(duration)}, unedited. Pause where you want a change, then use the buttons.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={locked} onClick={() => onChange({ ...trim, start: time })}>Start here</Button>
        <Button size="sm" variant="outline" disabled={locked} onClick={() => onChange({ ...trim, end: time })}>End here</Button>
        <Button size="sm" variant={mark === null ? "outline" : "destructive"} disabled={locked} onClick={cutSection}>
          <Scissors className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{mark === null ? "Cut a section from here" : `Cut ${fmt(Math.min(mark, time))} to ${fmt(Math.max(mark, time))}`}
        </Button>
        {mark !== null && <Button size="sm" variant="ghost" onClick={() => setMark(null)}>Cancel</Button>}
        {edited && mark === null && <Button size="sm" variant="ghost" disabled={locked} onClick={() => onChange(NO_TRIM)}>Reset</Button>}
      </div>
      {gaps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {gaps.map((g) => (
            <button key={g.from} type="button" disabled={locked} onClick={() => restore(g)}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label={`Put back ${fmt(g.from)} to ${fmt(g.to)}`}>
              Cut {fmt(g.from)} to {fmt(g.to)}<X className="h-3 w-3" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {locked && <p className="text-xs text-muted-foreground">Your voice-over is timed to this edit. Redo the take to change it.</p>}
    </div>
  );
}
