"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface VoiceRecorderProps {
  /** The shared player. It plays silently from `startAt` while recording, so the read lines up with the picture. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  startAt: number;
  /** Called by the player when the (edited) cut finishes. */
  onEnd: React.RefObject<(() => void) | null>;
  script?: string;
  take: Blob | null;
  onTake: (take: Blob | null) => void;
  /** True from the countdown until the recording stops. */
  onRecordingChange: (recording: boolean) => void;
  disabled?: boolean;
}

/** Records a voice-over against the cut as it is currently edited. The take is kept by the parent and sent on accept. */
export function VoiceRecorder({ videoRef, startAt, onEnd, script, take, onTake, onRecordingChange, disabled }: VoiceRecorderProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [phase, setPhase] = useState<"idle" | "countdown" | "recording">("idle");
  const [count, setCount] = useState(3);
  const [takeUrl, setTakeUrl] = useState<string | null>(null);

  const stopStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  useEffect(() => () => { stopStream(); }, []);
  useEffect(() => {
    if (!take) { setTakeUrl(null); return; }
    const url = URL.createObjectURL(take);
    setTakeUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [take]);

  const stop = () => {
    onEnd.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    videoRef.current?.pause();
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      streamRef.current = stream;
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 192_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        stopStream();
        onTake(new Blob(chunks, { type: recorder.mimeType }));
        setPhase("idle");
        onRecordingChange(false);
      };
      recorderRef.current = recorder;
      setPhase("countdown");
      onRecordingChange(true);
      videoRef.current?.pause();
      for (let n = 3; n > 0; n--) { setCount(n); await new Promise((r) => setTimeout(r, 800)); }
      const video = videoRef.current;
      if (video) { video.currentTime = startAt; video.muted = true; onEnd.current = stop; await video.play().catch(() => undefined); }
      recorder.start();
      setPhase("recording");
    } catch (err) {
      stopStream(); setPhase("idle"); onRecordingChange(false);
      toast.error(`Microphone unavailable: ${(err as Error).message}`);
    }
  };

  const playTake = () => {
    const video = videoRef.current; const audio = audioRef.current;
    if (!video || !audio) return;
    video.currentTime = startAt; audio.currentTime = 0; video.muted = true;
    onEnd.current = () => { audio.pause(); onEnd.current = null; };
    void video.play(); void audio.play();
  };

  const redo = () => {
    audioRef.current?.pause();
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.muted = false; }
    onEnd.current = null;
    onTake(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {script ? (
        <div className="max-h-[32vh] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">{script}</div>
      ) : (
        <p className="text-sm text-muted-foreground">No draft script for this cut. Talk through what the footage shows.</p>
      )}
      {takeUrl && <audio ref={audioRef} src={takeUrl} className="hidden" />}
      <div className="flex flex-wrap items-center gap-2">
        {phase === "idle" && !take && <Button className="flex-1" variant="outline" onClick={start} disabled={disabled}><Mic className="mr-2 h-4 w-4" aria-hidden="true" />Record voice-over</Button>}
        {phase === "countdown" && <Button className="flex-1" disabled>Get ready… {count}</Button>}
        {phase === "recording" && (
          <>
            <Badge variant="destructive">● Recording</Badge>
            <Button className="flex-1" variant="destructive" onClick={stop}><Square className="mr-2 h-4 w-4" aria-hidden="true" />Stop</Button>
          </>
        )}
        {phase === "idle" && take && (
          <>
            <Badge variant="outline">Take recorded</Badge>
            <Button className="flex-1" variant="outline" onClick={playTake} disabled={disabled}>Play back</Button>
            <Button className="flex-1" variant="outline" onClick={redo} disabled={disabled}><RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Redo</Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">The cut plays silently while you record, so your read lines up with the picture. Recording stops when the video ends. Captions are made from your recording.</p>
    </div>
  );
}
