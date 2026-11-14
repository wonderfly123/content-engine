"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clipAt, totalSeconds, type EditorClip } from "@/lib/reels/clips";

/** Above this speed a clip is shown by seeking frame to frame instead of real playback (browsers cannot play 60x). */
const NATIVE_MAX_SPEED = 2;

export interface ClipPlayer {
  /** Two stacked video elements: one shows the current clip, the other has the next clip's footage ready. */
  videoA: React.RefObject<HTMLVideoElement | null>;
  videoB: React.RefObject<HTMLVideoElement | null>;
  time: number;
  playing: boolean;
  seek: (t: number) => void;
  toggle: () => void;
  pause: () => void;
}

/**
 * Plays a clip list straight from the source footage, so edits show instantly without a render.
 * A clock drives the timeline; the videos follow it (real playback for normal-speed clips, seeking for timelapses).
 */
export function useClipPlayer(clips: EditorClip[], srcOf: (file: string) => string): ClipPlayer {
  const videoA = useRef<HTMLVideoElement | null>(null);
  const videoB = useRef<HTMLVideoElement | null>(null);
  const clipsRef = useRef(clips);
  const srcRef = useRef(srcOf);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const front = useRef<0 | 1>(0);
  const loaded = useRef<[string | null, string | null]>([null, null]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  /** Brings both video elements in line with the clock. Safe to call as often as needed. */
  const sync = useCallback(() => {
    const list = clipsRef.current;
    const hit = clipAt(list, timeRef.current);
    const els = [videoA.current, videoB.current];
    if (!hit || !els[0] || !els[1]) return;
    const clip = list[hit.index];
    const load = (slot: 0 | 1, c: EditorClip) => {
      const el = els[slot]!;
      if (loaded.current[slot] !== c.file) { el.src = srcRef.current(c.file); loaded.current[slot] = c.file; }
      el.style.objectPosition = c.cropX === undefined ? "50% 50%" : `${c.cropX * 100}% 50%`;
    };
    // Use whichever element already has this clip's footage.
    let f = front.current;
    if (loaded.current[f] !== clip.file && loaded.current[1 - f] === clip.file) f = (1 - f) as 0 | 1;
    front.current = f;
    const o = (1 - f) as 0 | 1;
    const el = els[f]!;
    const other = els[o]!;
    load(f, clip);
    // Swap only once the new clip has a frame to show, so cuts do not flash black.
    if (el.readyState >= 2) { el.style.opacity = "1"; other.style.opacity = "0"; }

    const want = clip.in + hit.offset * clip.speed;
    if (playingRef.current && clip.speed <= NATIVE_MAX_SPEED) {
      if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
      if (el.paused) void el.play().catch(() => undefined);
      if (!el.seeking && Math.abs(el.currentTime - want) > 0.3 * Math.max(1, clip.speed)) el.currentTime = want;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - want) > 0.02) el.currentTime = want;
    }

    if (!other.paused) other.pause();
    const next = list[hit.index + 1];
    if (next && next.file !== clip.file) {
      load(o, next);
      if (!other.seeking && Math.abs(other.currentTime - next.in) > 0.05) other.currentTime = next.in;
    }
  }, []);

  const pause = useCallback(() => { playingRef.current = false; setPlaying(false); sync(); }, [sync]);

  const seek = useCallback((t: number) => {
    timeRef.current = Math.min(Math.max(t, 0), totalSeconds(clipsRef.current));
    setTime(timeRef.current);
    sync();
  }, [sync]);

  const toggle = useCallback(() => {
    if (playingRef.current) { pause(); return; }
    if (timeRef.current >= totalSeconds(clipsRef.current) - 0.05) timeRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
  }, [pause]);

  // Follow edits: keep the clock inside the cut and show the frame under the playhead.
  useEffect(() => {
    clipsRef.current = clips;
    srcRef.current = srcOf;
    timeRef.current = Math.min(timeRef.current, totalSeconds(clips));
    setTime(timeRef.current);
    sync();
  }, [clips, srcOf, sync]);

  // While paused, a seek that arrived mid-seek is applied when the video is ready for it.
  useEffect(() => {
    const els = [videoA.current, videoB.current];
    els.forEach((el) => { el?.addEventListener("seeked", sync); el?.addEventListener("loadeddata", sync); });
    return () => els.forEach((el) => { el?.removeEventListener("seeked", sync); el?.removeEventListener("loadeddata", sync); });
  }, [sync]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const total = totalSeconds(clipsRef.current);
      timeRef.current = Math.min(timeRef.current + (now - last) / 1000, total);
      last = now;
      setTime(timeRef.current);
      if (timeRef.current >= total) { playingRef.current = false; setPlaying(false); sync(); return; }
      sync();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, sync]);

  return { videoA, videoB, time, playing, seek, toggle, pause };
}
