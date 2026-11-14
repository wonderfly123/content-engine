"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, Copy, Pause, Play, Redo2, Scissors, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MIN_OUT, clipAt, duplicateClip, flatten, outSeconds, overlayInto, splitAt, totalSeconds, type Clip, type CutState, type EditorClip, type OverClip } from "@/lib/reels/clips";
import type { ReelCutView } from "@/lib/reels/store";
import { ClipTimeline } from "./clip-timeline";
import { useClipPlayer } from "./use-clip-player";

interface ClipEditorProps {
  cut: ReelCutView;
  open: boolean;
  onClose: () => void;
  /** Called after a save or revert, once the cut has a new preview. */
  onSaved: () => void;
}

/** Full-screen clip editor. Opens over the review dialog; nothing changes on disk until Save. */
export function ClipEditor({ cut, open, onClose, onSaved }: ClipEditorProps) {
  const clipsQ = useQuery({
    queryKey: ["reel-clips", cut.job, cut.id, cut.edl],
    queryFn: async () => {
      const res = await fetch(`/api/reels/clips?job=${encodeURIComponent(cut.job)}&id=${encodeURIComponent(cut.id)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { clips?: Array<Clip & { max: number }>; error?: string };
      if (!res.ok || !body.clips) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body.clips.map((c, i): EditorClip => ({ ...c, key: `c${i}` }));
    },
    enabled: open,
    staleTime: Infinity,
    gcTime: 0,
  });

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:max-w-none"
      >
        <DialogDescription className="sr-only">Trim, extend, reorder, split and delete the clips in this cut.</DialogDescription>
        {clipsQ.data ? (
          <EditorBody cut={cut} initial={clipsQ.data} onClose={onClose} onSaved={onSaved} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <DialogTitle className="text-base">Edit clips · {cut.title}</DialogTitle>
            <p className="text-sm text-muted-foreground">{clipsQ.isError ? `Could not open the clips: ${(clipsQ.error as Error).message}` : "Loading the clips…"}</p>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface History { past: CutState[]; present: CutState; future: CutState[] }

function EditorBody({ cut, initial, onClose, onSaved }: { cut: ReelCutView; initial: EditorClip[]; onClose: () => void; onSaved: () => void }) {
  const [hist, setHist] = useState<History>({ past: [], present: { main: initial, over: [] }, future: [] });
  // A drag in progress: shown and played, but not in the undo history until it lands.
  const [draft, setDraft] = useState<CutState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pps, setPps] = useState(48);
  const view = draft ?? hist.present;
  // What plays and what gets saved: the cut with every top-lane clip showing over it.
  const clips = useMemo(() => flatten(view), [view]);
  const total = totalSeconds(clips);
  const dirty = hist.past.length > 0;

  const srcOf = useCallback((file: string) => `/api/reels/media?footage=1&job=${encodeURIComponent(cut.job)}&file=${encodeURIComponent(file)}`, [cut.job]);
  const player = useClipPlayer(clips, srcOf);
  // A frame to show once an edit has been applied (the edge being dragged).
  const showAfterEdit = useRef<number | null>(null);
  useEffect(() => {
    if (showAfterEdit.current === null) return;
    player.seek(showAfterEdit.current);
    showAfterEdit.current = null;
  }, [clips, player]);

  // Thumbnails come from the last committed state, so dragging an edge does not request a new frame on every pixel.
  const committed = new Map([...hist.present.main, ...hist.present.over].map((c) => [c.key, c]));
  const thumbOf = (clip: EditorClip) => {
    const c = committed.get(clip.key) ?? clip;
    return `/api/reels/thumb?job=${encodeURIComponent(cut.job)}&file=${encodeURIComponent(c.file)}&t=${(Math.round((c.in + c.dur / 2) * 2) / 2).toFixed(1)}`;
  };

  const nextKey = useRef(0);
  const commit = (next: CutState) => {
    setDraft(null);
    setHist((h) => (next === h.present ? h : { past: [...h.past, h.present].slice(-100), present: next, future: [] }));
  };
  const undo = () => { setDraft(null); setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)); };
  const redo = () => { setDraft(null); setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)); };
  const { main, over } = hist.present;
  const topIndex = over.findIndex((c) => c.key === selected);
  const top: OverClip | undefined = over[topIndex];
  const newKey = (prefix: string) => `${prefix}${nextKey.current++}`;

  const split = () => {
    const offset = top ? player.time - top.at : -1;
    if (top && offset >= MIN_OUT && outSeconds(top) - offset >= MIN_OUT) {
      // The selected top clip is under the playhead: split that one, in place.
      const used = Math.round(offset * top.speed * 1000) / 1000;
      const pieces: OverClip[] = [{ ...top, dur: used }, { ...top, key: newKey("s"), at: top.at + offset, in: top.in + used, dur: top.dur - used }];
      commit({ main, over: [...over.slice(0, topIndex), ...pieces, ...over.slice(topIndex + 1)] });
      return;
    }
    // Otherwise split the cut's own clip under the playhead (the playhead may be showing a top clip instead).
    const hit = clipAt(main, player.time);
    if (hit) commit({ main: splitAt(main, player.time, newKey("s")), over });
  };

  // Duplicate (or paste a copied clip) right after the selected clip, or the one under the playhead. The copy becomes the selection.
  const copied = useRef<EditorClip | null>(null);
  const pasteAfter = (source: EditorClip | null) => {
    const key = newKey("d");
    if (top) {
      const { at: _at, ...plain } = { at: 0, ...(source ?? top) };
      commit({ main, over: [...over, { ...plain, key, at: top.at + outSeconds(top) }] });
    } else {
      const at = selected ? main.findIndex((c) => c.key === selected) : clipAt(main, player.time)?.index ?? -1;
      if (at < 0) return;
      const { at: _at, ...plain } = { at: 0, ...(source ?? main[at]) };
      commit({ main: source ? [...main.slice(0, at + 1), { ...plain, key }, ...main.slice(at + 1)] : duplicateClip(main, at, key), over });
    }
    setSelected(key);
  };
  const copy = () => { copied.current = [...main, ...over].find((c) => c.key === selected) ?? null; if (copied.current) toast.success("Clip copied"); };
  const remove = () => {
    if (top) commit({ main, over: over.filter((c) => c.key !== selected) });
    else if (selected && main.length > 1 && main.some((c) => c.key === selected)) commit({ main: main.filter((c) => c.key !== selected), over });
    else return;
    setSelected(null);
  };
  // Swap the selected top clip into the cut: it takes the place of whatever it covers, and the top lane is clear again.
  const swapIn = () => {
    if (!top) return;
    commit({ main: overlayInto(main, top, () => newKey("p")), over: over.filter((c) => c.key !== top.key) });
  };

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/reels/clips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: cut.job, id: cut.id, ...body }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    },
    onSuccess: (_d, body) => { toast.success("revert" in body ? "Back to the original cut" : "Saved. The preview now shows your edit."); onSaved(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const saveClips = () => {
    player.pause();
    save.mutate({ clips: flatten(hist.present).map(({ file, in: start, dur, speed, cropX }) => ({ file, in: start, dur, speed, ...(cropX === undefined ? {} : { cropX }) })) });
  };

  // Keyboard, CapCut-style. Kept in a ref so the listener always sees the latest state.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keys.current = (e) => {
      if (save.isPending || (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === " ") player.toggle();
      else if (mod && e.key.toLowerCase() === "z") { if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === "c") { if (!selected) return; copy(); }
      else if (mod && e.key.toLowerCase() === "v") { if (!copied.current) return; pasteAfter(copied.current); }
      else if (mod && e.key.toLowerCase() === "d") pasteAfter(null);
      else if (e.key === "Enter" && top) swapIn();
      else if (e.key === "Backspace" || e.key === "Delete") remove();
      else if (e.key.toLowerCase() === "s" && !mod) split();
      else if (e.key === "ArrowLeft") player.seek(player.time - (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === "ArrowRight") player.seek(player.time + (e.shiftKey ? 1 : 1 / 30));
      else return;
      e.preventDefault();
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <DialogTitle className="mr-auto text-base">Edit clips · {cut.title}</DialogTitle>
        {cut.original && !dirty && <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ revert: true })}>Back to the original cut</Button>}
        <Button size="sm" variant="outline" disabled={save.isPending} onClick={onClose}>{dirty ? "Discard changes" : "Close"}</Button>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={saveClips}>{save.isPending ? "Rendering…" : "Save"}</Button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/90 p-3">
        <div className="relative aspect-[9/16] h-full max-w-full overflow-hidden rounded-md bg-black" onClick={player.toggle} role="presentation">
          <video ref={player.videoA} muted playsInline preload="auto" className="absolute inset-0 h-full w-full object-cover" />
          <video ref={player.videoB} muted playsInline preload="auto" className="absolute inset-0 h-full w-full object-cover opacity-0" />
        </div>
        {save.isPending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-center text-sm text-white">
            Rendering your edit into a new preview.<br />This usually takes a minute or two. Keep this window open.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2">
        <Button size="sm" variant="outline" onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"}>
          {player.playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <span className="w-36 text-sm tabular-nums">{player.time.toFixed(1)} / {total.toFixed(1)}s <span className="text-muted-foreground">of {cut.seconds}s</span></span>
        <Button size="sm" variant="outline" onClick={split}><Scissors className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Split</Button>
        <Button size="sm" variant="outline" onClick={() => pasteAfter(null)}><Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Duplicate</Button>
        <Button size="sm" variant={top ? "default" : "outline"} onClick={swapIn} disabled={!top}><ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Swap into cut</Button>
        <Button size="sm" variant="outline" onClick={remove} disabled={!selected || (!top && main.length < 2)}><Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Delete</Button>
        <Button size="sm" variant="ghost" onClick={undo} disabled={!hist.past.length} aria-label="Undo"><Undo2 className="h-4 w-4" aria-hidden="true" /></Button>
        <Button size="sm" variant="ghost" onClick={redo} disabled={!hist.future.length} aria-label="Redo"><Redo2 className="h-4 w-4" aria-hidden="true" /></Button>
        <p className="mx-auto hidden text-xs text-muted-foreground lg:block">Drag edges to trim or extend · drag a clip up to the top lane to lay it over the cut · Cmd+C / Cmd+V copies</p>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPps((p) => Math.max(12, p / 1.5))} aria-label="Zoom out"><ZoomOut className="h-4 w-4" aria-hidden="true" /></Button>
        <Button size="sm" variant="ghost" onClick={() => setPps((p) => Math.min(400, p * 1.5))} aria-label="Zoom in"><ZoomIn className="h-4 w-4" aria-hidden="true" /></Button>
      </div>

      <div className="border-t px-2 pt-1">
        <ClipTimeline
          state={view}
          pps={pps}
          time={player.time}
          follow={player.playing}
          selected={selected}
          thumbOf={thumbOf}
          onSeek={(t) => { player.pause(); player.seek(t); }}
          onSelect={setSelected}
          onChange={(next, phase, at) => {
            if (at !== undefined) { player.pause(); showAfterEdit.current = at; }
            if (phase === "live") setDraft(next);
            else if (phase === "commit") commit(next);
            else setDraft(null);
          }}
        />
      </div>
    </>
  );
}
