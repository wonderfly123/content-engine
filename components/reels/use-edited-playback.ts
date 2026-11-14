"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keptRanges, playableAt, type ReelRange, type TrimState } from "@/lib/reels/edits";

/**
 * Plays a video as if the trim were already applied: playback starts at the trim start,
 * jumps over cut sections and stops at the trim end. `onEnd` fires when the edited cut finishes.
 */
export function useEditedPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  trim: TrimState,
  onEnd: React.RefObject<(() => void) | null>,
): { time: number; duration: number; keep: ReelRange[] } {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const keep = useMemo(() => (duration > 0 ? keptRanges(trim, duration) : []), [trim, duration]);
  const keepRef = useRef(keep);
  useEffect(() => { keepRef.current = keep; }, [keep]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const readDuration = () => setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    // Pressing play after the edited cut has finished starts it again from the top.
    const onPlay = () => {
      const k = keepRef.current;
      if (k.length && playableAt(k, video.currentTime) === null) video.currentTime = k[0].from;
    };
    const onEnded = () => onEnd.current?.();
    const tick = () => {
      const k = keepRef.current;
      if (k.length && !video.paused && !video.seeking) {
        const next = playableAt(k, video.currentTime);
        if (next === null) {
          video.pause();
          onEnd.current?.();
        } else if (next - video.currentTime > 0.02) {
          video.currentTime = next;
        }
      }
      setTime((prev) => (Math.abs(prev - video.currentTime) > 0.03 ? video.currentTime : prev));
      frame = requestAnimationFrame(tick);
    };
    if (video.readyState >= 1) readDuration();
    video.addEventListener("loadedmetadata", readDuration);
    video.addEventListener("durationchange", readDuration);
    video.addEventListener("play", onPlay);
    video.addEventListener("ended", onEnded);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("loadedmetadata", readDuration);
      video.removeEventListener("durationchange", readDuration);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("ended", onEnded);
    };
  }, [videoRef, onEnd]);

  return { time, duration, keep };
}
