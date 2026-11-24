"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, PenLine, RotateCcw, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { speakableScript, spokenTextProblem } from "@/lib/reels/voice-script";

interface VoiceRecorderProps {
  /** The shared player. It plays silently from `startAt` while recording, so the read lines up with the picture. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  startAt: number;
  /** Called by the player when the (edited) cut finishes. */
  onEnd: React.RefObject<(() => void) | null>;
  script?: string;
  /** record = the reviewer reads it; ai = the AI voice speaks the script. */
  method: "record" | "ai";
  /** The cut the AI voice is generated for. */
  job: string;
  cutId: string;
  take: Blob | null;
  onTake: (take: Blob | null) => void;
  /** True from the countdown until the recording stops. */
  onRecordingChange: (recording: boolean) => void;
  disabled?: boolean;
}

/** Records a voice-over against the cut as it is currently edited. The take is kept by the parent and sent on accept. */
export function VoiceRecorder({ videoRef, startAt, onEnd, script, method, job, cutId, take, onTake, onRecordingChange, disabled }: VoiceRecorderProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [phase, setPhase] = useState<"idle" | "countdown" | "recording">("idle");
  const [count, setCount] = useState(3);
  const [takeUrl, setTakeUrl] = useState<string | null>(null);
  // AI voice-over: the reviewer edits what will be said, then the voice tool speaks it. No recording.
  const [generating, setGenerating] = useState(false);
  const [aiText, setAiText] = useState(() => speakableScript(script));
  const [aiError, setAiError] = useState<string | null>(null);
  const [fromAi, setFromAi] = useState(false);
  const aiProblem = spokenTextProblem(aiText);
  const [writing, setWriting] = useState(false);
  const autoWrote = useRef(false);

  /** Has Claude write the lines from the job's story, earlier voice-overs and the editor's draft. */
  const writeScript = async () => {
    setAiError(null);
    setWriting(true);
    try {
      const res = await fetch("/api/reels/voice-script", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, id: cutId }) });
      const json = (await res.json().catch(() => ({}))) as { script?: string; error?: string };
      if (!res.ok || !json.script) throw new Error(json.error ?? `HTTP ${res.status}`);
      setAiText(json.script);
    } catch (err) {
      setAiError(`The script could not be written: ${(err as Error).message}`);
    } finally {
      setWriting(false);
    }
  };
  // A script is always there to start from: when the draft cannot be spoken as it is (none, or open [brackets]), one is written.
  useEffect(() => {
    if (method !== "ai" || take || autoWrote.current) return;
    autoWrote.current = true;
    if (spokenTextProblem(aiText)) void writeScript();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, take]);

  const generate = async () => {
    setAiError(null);
    setGenerating(true);
    onRecordingChange(true);
    try {
      const res = await fetch("/api/reels/voice-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, id: cutId, text: aiText }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      const wav = await res.blob();
      if (!wav.size) throw new Error("The AI voice returned no audio.");
      setFromAi(true);
      onTake(new Blob([wav], { type: "audio/wav" }));
    } catch (err) {
      const message = (err as Error).message;
      setAiError(message);
      toast.error(`AI voice-over failed: ${message}`);
    } finally {
      setGenerating(false);
      onRecordingChange(false);
    }
  };

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
        setFromAi(false);
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
      {method === "ai" ? null : script ? (
        <div className="max-h-[32vh] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">{script}</div>
      ) : (
        <p className="text-sm text-muted-foreground">No draft script for this cut. Talk through what the footage shows.</p>
      )}
      {takeUrl && <audio ref={audioRef} src={takeUrl} className="hidden" />}
      <div className="flex flex-wrap items-center gap-2">
        {phase === "idle" && !take && method === "record" && <Button className="flex-1" variant="outline" onClick={start} disabled={disabled}><Mic className="mr-2 h-4 w-4" aria-hidden="true" />Record voice-over</Button>}
        {phase === "countdown" && <Button className="flex-1" disabled>Get ready… {count}</Button>}
        {phase === "recording" && (
          <>
            <Badge variant="destructive">● Recording</Badge>
            <Button className="flex-1" variant="destructive" onClick={stop}><Square className="mr-2 h-4 w-4" aria-hidden="true" />Stop</Button>
          </>
        )}
        {phase === "idle" && take && (
          <>
            <Badge variant="outline">{fromAi ? "AI take ready" : "Take recorded"}</Badge>
            <Button className="flex-1" variant="outline" onClick={playTake} disabled={disabled}>Play back</Button>
            <Button className="flex-1" variant="outline" onClick={redo} disabled={disabled}><RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Redo</Button>
          </>
        )}
      </div>
      {phase === "idle" && !take && method === "ai" && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <label htmlFor="ai-voice-text" className="text-sm font-medium">What the AI voice will say</label>
          <Textarea id="ai-voice-text" rows={7} value={aiText} onChange={(e) => setAiText(e.target.value)} disabled={generating || writing} placeholder={writing ? "Writing a script…" : "Write the voice-over here. Each line is spoken on its own, with a pause between lines."} />
          {!generating && !writing && aiProblem && aiText.trim() && <p className="text-xs text-muted-foreground">{aiProblem}</p>}
          {aiError && !generating && !writing && <p role="alert" className="text-sm text-destructive">{aiError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button className="flex-1" onClick={generate} disabled={disabled || generating || writing || aiProblem !== null}>
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
              {generating ? "Generating…" : "Generate voice-over"}
            </Button>
            <Button variant="outline" onClick={writeScript} disabled={disabled || generating || writing}>
              {writing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <PenLine className="mr-2 h-4 w-4" aria-hidden="true" />}
              {writing ? "Writing…" : aiText.trim() ? "Regenerate script" : "Write script"}
            </Button>
          </div>
          {generating && <p role="status" className="text-xs text-muted-foreground">Speaking the script in your cloned voice on this Mac. This takes a few minutes; keep this window open.</p>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{method === "ai" ? "The AI voice is a clone of your voice. Play it back against the cut before accepting. Captions are made from it." : "The cut plays silently while you record, so your read lines up with the picture. Recording stops when the video ends. Captions are made from your recording."}</p>
    </div>
  );
}
