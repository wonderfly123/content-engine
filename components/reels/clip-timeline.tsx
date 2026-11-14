"use client";

import { useEffect, useRef, useState } from "react";
import { clipStarts, moveClip, outSeconds, snapTo, totalSeconds, trimLeft, trimRight, type CutState, type EditorClip, type OverClip } from "@/lib/reels/clips";

/** Space before the first clip and after the last, in pixels. */
const PAD = 24;
/** A press that moves less than this is a click, not a drag. */
const CLICK_SLOP = 5;
/** How close (in pixels) an edge has to be to a cut point to snap to it. */
const SNAP_PX = 9;

type Kind = "scrub" | "left" | "right" | "move" | "topLeft" | "topRight" | "topMove";

interface Gesture {
  kind: Kind;
  index: number;
  startX: number;
  /** Seconds between the grabbed point and the clip's start. */
  grab: number;
  base: CutState;
  latest: CutState | null;
  moved: boolean;
  /** Results kept here, not only in state, so a fast flick still lands. */
  to: number;
  shift: number;
  liftAt: number | null;
  dropTo: number | null;
}

interface ClipTimelineProps {
  state: CutState;
  /** Zoom: pixels per second of timeline. */
  pps: number;
  time: number;
  /** Keep the playhead in view (while playing). */
  follow: boolean;
  selected: string | null;
  thumbOf: (clip: EditorClip) => string;
  onSeek: (t: number) => void;
  onSelect: (key: string | null) => void;
  /** "live" while a drag is in progress (not yet in history), "commit" when it lands. `at` is the frame to show. */
  onChange: (state: CutState, phase: "live" | "commit" | "cancel", at?: number) => void;
}

/**
 * Two lanes. The bottom lane is the cut: clips sit end to end, and trimming one moves the rest along.
 * The top lane holds clips laid over the cut: they go anywhere, snap to cut points, and are what shows on screen.
 * Drag a clip up or down to change lanes.
 */
export function ClipTimeline({ state, pps, time, follow, selected, thumbOf, onSeek, onSelect, onChange }: ClipTimelineProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const mainLane = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  // While the left edge of a cut clip is dragged the track slides so the edge stays under the cursor.
  const [shift, setShift] = useState(0);
  // What a drag in progress would do: reorder within the cut, lift onto the top lane, or drop into the cut.
  const [hint, setHint] = useState<{ key: string; dx?: number; insertAt?: number; snapAt?: number } | null>(null);

  const { main, over } = state;
  const starts = clipStarts(main);
  const total = totalSeconds(main);
  const end = Math.max(total, ...over.map((c) => c.at + outSeconds(c)));
  const timeAt = (clientX: number) => (clientX - (inner.current?.getBoundingClientRect().left ?? 0) - PAD) / pps;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !follow || gesture.current) return;
    const x = PAD + time * pps;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, x - 120);
  }, [time, pps, follow]);

  /** Cut points a top clip snaps to: every cut in the bottom lane, the playhead, and the edges of the other top clips. */
  const snapTargets = (g: Gesture, skipKey: string) => {
    const s = clipStarts(g.base.main);
    return [...s, totalSeconds(g.base.main), time, ...g.base.over.filter((c) => c.key !== skipKey).flatMap((c) => [c.at, c.at + outSeconds(c)])];
  };
  /** Where a clip of length `len` wanting to start at `raw` should sit: snapped by its start, else by its end. */
  const snapClip = (raw: number, len: number, targets: number[]) => {
    const tol = SNAP_PX / pps;
    const byStart = snapTo(raw, targets, tol);
    if (byStart !== raw) return { at: byStart, line: byStart as number | undefined };
    const byEnd = snapTo(raw + len, targets, tol);
    if (byEnd !== raw + len && byEnd - len >= 0) return { at: byEnd - len, line: byEnd as number | undefined };
    return { at: raw, line: undefined };
  };

  // Drags are followed on the window, not the block: a block changes lanes mid-drag, which would drop a capture on it.
  const live = useRef<{ move: (e: PointerEvent) => void; finish: (e: PointerEvent) => void }>({ move: () => undefined, finish: () => undefined });
  const begin = (e: React.PointerEvent, kind: Kind, index: number) => {
    e.stopPropagation();
    e.preventDefault();
    const onMove = (ev: PointerEvent) => live.current.move(ev);
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      live.current.finish(ev);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    const top = kind.startsWith("top");
    const clipStart = kind === "scrub" ? 0 : top ? over[index].at : starts[index];
    gesture.current = { kind, index, startX: e.clientX, grab: timeAt(e.clientX) - clipStart, base: state, latest: null, moved: false, to: index, shift: 0, liftAt: null, dropTo: null };
    if (kind === "scrub") onSeek(timeAt(e.clientX));
    else onSelect((top ? over : main)[index].key);
  };

  const move = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    if (g.kind === "scrub") { onSeek(timeAt(e.clientX)); return; }
    const laneTop = mainLane.current?.getBoundingClientRect().top ?? 0;
    const lifting = g.kind === "move" && e.clientY < laneTop - 6;
    const dropping = g.kind === "topMove" && e.clientY > laneTop + 14;
    if (!g.moved && Math.abs(dx) < CLICK_SLOP && !lifting && !dropping) return;
    g.moved = true;
    const tol = SNAP_PX / pps;

    if (g.kind === "move") {
      const base = g.base.main[g.index];
      const baseStarts = clipStarts(g.base.main);
      if (lifting) {
        // Up onto the top lane. The cut closes up behind it straight away, so it is placed against the cut as it will be.
        const rest = g.base.main.filter((_, i) => i !== g.index);
        const targets = [...clipStarts(rest), totalSeconds(rest), time, ...g.base.over.flatMap((c) => [c.at, c.at + outSeconds(c)])];
        const spot = snapClip(Math.max(0, timeAt(e.clientX) - g.grab), outSeconds(base), targets);
        g.liftAt = spot.at;
        g.latest = { main: rest, over: [...g.base.over, { ...base, at: spot.at }] };
        setHint(spot.line === undefined ? null : { key: base.key, snapAt: spot.line });
        onChange(g.latest, "live");
        return;
      }
      if (g.liftAt !== null) { g.liftAt = null; g.latest = null; onChange(g.base, "cancel"); }
      const center = (baseStarts[g.index] + outSeconds(base) / 2) * pps + dx;
      const before = g.base.main.filter((c, i) => i !== g.index && (baseStarts[i] + outSeconds(c) / 2) * pps < center).length;
      g.to = before <= g.index ? before : before + 1;
      setHint({ key: base.key, dx, insertAt: g.to });
      return;
    }

    if (g.kind === "topMove") {
      const base = g.base.over[g.index];
      if (dropping) {
        // Down into the cut, between the two clips nearest the cursor.
        const s = clipStarts(g.base.main);
        const at = timeAt(e.clientX);
        g.dropTo = g.base.main.filter((c, i) => s[i] + outSeconds(c) / 2 < at).length;
        setHint({ key: base.key, insertAt: g.dropTo });
        return;
      }
      g.dropTo = null;
      const spot = snapClip(Math.max(0, base.at + dx / pps), outSeconds(base), snapTargets(g, base.key));
      g.latest = { main: g.base.main, over: g.base.over.map((c, i) => (i === g.index ? { ...c, at: spot.at } : c)) };
      setHint(spot.line === undefined ? null : { key: base.key, snapAt: spot.line });
      onChange(g.latest, "live");
      return;
    }

    if (g.kind === "topLeft" || g.kind === "topRight") {
      // A top clip's edges move on their own (nothing ripples) and snap to the cut points under them.
      const base = g.base.over[g.index];
      const targets = snapTargets(g, base.key);
      let next: OverClip;
      let edge: number;
      if (g.kind === "topLeft") {
        const trimmed = trimLeft(base, snapTo(base.at + dx / pps, targets, tol) - base.at);
        next = { ...trimmed, at: base.at + (trimmed.in - base.in) / base.speed };
        edge = next.at;
      } else {
        const baseEnd = base.at + outSeconds(base);
        next = trimRight(base, snapTo(baseEnd + dx / pps, targets, tol) - baseEnd, base.max);
        edge = next.at + outSeconds(next);
      }
      g.latest = { main: g.base.main, over: g.base.over.map((c, i) => (i === g.index ? next : c)) };
      setHint(targets.some((t) => Math.abs(t - edge) < 0.002) ? { key: base.key, snapAt: edge } : null);
      onChange(g.latest, "live", g.kind === "topLeft" ? edge + 0.001 : edge - 1 / 30);
      return;
    }

    const base = g.base.main[g.index];
    const baseStarts = clipStarts(g.base.main);
    const next = g.kind === "left" ? trimLeft(base, dx / pps) : trimRight(base, dx / pps, base.max);
    g.latest = { main: g.base.main.map((c, i) => (i === g.index ? next : c)), over: g.base.over };
    if (g.kind === "left") { g.shift = ((next.in - base.in) / base.speed) * pps; setShift(g.shift); }
    // Show the frame at the edge being dragged: the clip's new first frame, or its new last one.
    onChange(g.latest, "live", g.kind === "left" ? baseStarts[g.index] + 0.001 : baseStarts[g.index] + outSeconds(next) - 1 / 30);
  };

  const finish = (e: PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setHint(null);
    if (!g || g.kind === "scrub") return;
    const { main: m, over: o } = g.base;
    if (!g.moved) {
      if (g.kind === "move" || g.kind === "topMove") onSeek(timeAt(e.clientX));
      return;
    }
    if (g.kind === "move") {
      if (g.liftAt !== null && g.latest) onChange(g.latest, "commit");
      else if (g.to !== g.index && g.to !== g.index + 1) onChange({ main: moveClip(m, g.index, g.to), over: o }, "commit");
      return;
    }
    if (g.kind === "topMove" && g.dropTo !== null) {
      const { at: _at, ...clip } = o[g.index];
      onChange({ main: [...m.slice(0, g.dropTo), clip, ...m.slice(g.dropTo)], over: o.filter((_, i) => i !== g.index) }, "commit");
      return;
    }
    if (g.kind === "left" && scroller.current) scroller.current.scrollLeft -= g.shift;
    setShift(0);
    if (g.latest) onChange(g.latest, "commit");
    else onChange(g.base, "cancel");
  };

  useEffect(() => { live.current = { move, finish }; });
  const drag = (kind: Kind, index: number) => ({ onPointerDown: (e: React.PointerEvent) => begin(e, kind, index) });

  const block = (clip: EditorClip, i: number, top: boolean) => {
    const width = outSeconds(clip) * pps;
    const handle = Math.max(4, Math.min(12, width / 3));
    const chosen = selected === clip.key;
    const carried = hint?.key === clip.key && (hint.dx !== undefined || hint.insertAt !== undefined);
    return (
      <div
        key={clip.key}
        {...drag(top ? "topMove" : "move", i)}
        className={`group absolute top-0 h-full touch-none overflow-hidden rounded-md border bg-muted bg-[length:auto_100%] bg-repeat-x ${chosen ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""} ${carried ? "z-20 cursor-grabbing opacity-60" : "cursor-grab"}`}
        style={{ left: PAD + (top ? (clip as OverClip).at : starts[i]) * pps, width: Math.max(width - 2, 2), backgroundImage: `url("${thumbOf(clip)}")`, transform: carried && hint?.dx !== undefined ? `translateX(${hint.dx}px)` : undefined }}
        aria-label={`${top ? "Top clip" : "Clip"} ${i + 1}, ${outSeconds(clip).toFixed(1)} seconds`}
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-black/55 px-1.5 py-0.5 text-[10px] leading-tight text-white">
          <span>{outSeconds(clip).toFixed(1)}s</span>
          {clip.speed !== 1 && width > 56 && <span>{clip.speed >= 10 ? clip.speed.toFixed(0) : clip.speed.toFixed(1)}x</span>}
        </div>
        <div {...drag(top ? "topLeft" : "left", i)} className={`absolute inset-y-0 left-0 cursor-ew-resize touch-none rounded-l-md bg-primary ${chosen ? "opacity-90" : "opacity-0 group-hover:opacity-70"}`} style={{ width: handle }} aria-label="Drag to change where this clip starts" />
        <div {...drag(top ? "topRight" : "right", i)} className={`absolute inset-y-0 right-0 cursor-ew-resize touch-none rounded-r-md bg-primary ${chosen ? "opacity-90" : "opacity-0 group-hover:opacity-70"}`} style={{ width: handle }} aria-label="Drag to change where this clip ends" />
      </div>
    );
  };

  // Ruler marks: every second when zoomed in, every five when zoomed out; a label on every fifth mark.
  const step = pps >= 30 ? 1 : 5;
  const marks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);
  const clearOnEmpty = (e: React.PointerEvent) => { if (e.target === e.currentTarget) { onSelect(null); onSeek(timeAt(e.clientX)); } };

  return (
    <div ref={scroller} className="overflow-x-auto overflow-y-hidden pb-2">
      <div ref={inner} className="relative select-none" style={{ width: end * pps + PAD * 2 + 200, transform: shift ? `translateX(${shift}px)` : undefined }}>
        <div className="relative h-7 cursor-col-resize touch-none border-b text-[10px] text-muted-foreground" {...drag("scrub", -1)}>
          {marks.map((s) => (
            <div key={s} className="absolute bottom-0 border-l pl-1" style={{ left: PAD + s * pps, height: s % (step * 5) === 0 ? "100%" : "35%" }}>
              {s % (step * 5) === 0 ? `${s}s` : ""}
            </div>
          ))}
        </div>
        <div className="relative mt-2 h-16 rounded-md bg-muted/40" onPointerDown={clearOnEmpty}>
          {over.length === 0 && <p className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Top lane · drag a clip up here to lay it over the cut. Whatever is on top is what shows.</p>}
          {over.map((clip, i) => block(clip, i, true))}
        </div>
        <div ref={mainLane} className="relative mt-1.5 h-24" onPointerDown={clearOnEmpty}>
          {main.map((clip, i) => block(clip, i, false))}
          {hint?.insertAt !== undefined && (
            <div className="pointer-events-none absolute -top-1 -bottom-1 z-30 w-1 rounded bg-primary" style={{ left: PAD + (hint.insertAt < main.length ? starts[hint.insertAt] : total) * pps - 2 }} />
          )}
        </div>
        {hint?.snapAt !== undefined && <div className="pointer-events-none absolute top-7 bottom-0 z-30 w-0.5 bg-primary" style={{ left: PAD + hint.snapAt * pps - 1 }} />}
        <div className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-red-500" style={{ left: PAD + time * pps }}>
          <div className="absolute -left-[5px] top-0 h-3 w-[11px] rounded-b bg-red-500" />
        </div>
      </div>
    </div>
  );
}
