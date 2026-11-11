"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Mic, RotateCcw, Square, Upload } from "lucide-react";
import { toast } from "sonner";
import { useBrandStore } from "@/lib/stores/brand-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ReelCutView } from "@/lib/reels/store";

const STAGES = {
  cuts: { title: "Cut review", blurb: "Watch each cut. Approve it, or say what should change.", show: ["cut_review"] },
  voiceover: { title: "Voice-over queue", blurb: "Approved voice-led cuts waiting for your recording.", show: ["voiceover"] },
  final: { title: "Final review", blurb: "Finished videos. Approve the caption and pick a time to put them on the calendar.", show: ["final_review", "editing", "scheduled"] },
} as const;
type StageKey = keyof typeof STAGES;

const mediaUrl = (cut: ReelCutView, file: string) => `/api/reels/media?job=${encodeURIComponent(cut.job)}&file=${encodeURIComponent(file)}`;

async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
}
const patch = (body: Record<string, unknown>) =>
  send("/api/reels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function InstagramPipelinePage() {
  const params = useParams<{ stage: string }>();
  const stageKey: StageKey = params.stage in STAGES ? (params.stage as StageKey) : "cuts";
  const stage = STAGES[stageKey];
  const brand = useBrandStore((s) => s.active);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["reels"] });

  const { data, isLoading } = useQuery({
    queryKey: ["reels", brand?.slug],
    queryFn: async () => {
      const res = await fetch(`/api/reels?brand=${encodeURIComponent(brand!.slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { cuts: ReelCutView[] }).cuts;
    },
    enabled: Boolean(brand?.slug),
    refetchInterval: 15_000,
  });

  const cuts = (data ?? []).filter((c) => (stage.show as readonly string[]).includes(c.stage));
  const order = (c: ReelCutView) => stage.show.indexOf(c.stage as never);
  cuts.sort((a, b) => order(a) - order(b) || a.job.localeCompare(b.job) || a.seconds - b.seconds);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Review Pipeline · Instagram Reels</p>
        <h1 className="text-2xl font-semibold">{stage.title}</h1>
        <p className="text-sm text-muted-foreground">{stage.blurb}</p>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && cuts.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nothing here for {brand?.name ?? "this brand"}. Cuts appear when the video skill adds them to a job.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {cuts.map((cut) => (
          <Card key={`${cut.job}/${cut.id}`} className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="truncate">{cut.title}</span>
                <Badge variant="secondary">{cut.seconds}s · {cut.mode === "voice" ? "voice-led" : "music-led"}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{cut.job}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {cut.stage === "cut_review" && <CutReview cut={cut} onDone={refresh} />}
              {cut.stage === "voiceover" && <VoiceRecorder cut={cut} onDone={refresh} />}
              {cut.stage === "final_review" && <FinalReview cut={cut} onDone={refresh} />}
              {cut.stage === "editing" && (
                <>
                  <Player cut={cut} file={cut.preview} />
                  <Badge variant="outline" className="w-fit">With the editor</Badge>
                  <p className="text-sm text-muted-foreground">
                    {cut.note ? `Changes requested: ${cut.note}` : cut.voiceover ? "Voice-over recorded. Waiting for the mix and captions." : "Waiting for the finished file and caption."}
                  </p>
                </>
              )}
              {cut.stage === "scheduled" && (
                <>
                  <Player cut={cut} file={cut.final ?? cut.preview} />
                  <Badge className="w-fit">Scheduled</Badge>
                  <p className="text-sm text-muted-foreground">
                    {cut.scheduledFor ? new Date(cut.scheduledFor).toLocaleString() : ""} · {cut.trial ? "trial Reel" : "normal Reel"}. See the Calendar.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Player({ cut, file, videoRef, muted }: { cut: ReelCutView; file: string; videoRef?: React.RefObject<HTMLVideoElement | null>; muted?: boolean }) {
  return (
    <video
      ref={videoRef}
      src={mediaUrl(cut, file)}
      controls
      muted={muted}
      playsInline
      preload="metadata"
      className="aspect-[9/16] w-full rounded-md bg-black object-contain"
    />
  );
}

function CutReview({ cut, onDone }: { cut: ReelCutView; onDone: () => void }) {
  const [note, setNote] = useState("");
  const act = useMutation({
    mutationFn: (action: "approve_cut" | "request_changes") => patch({ job: cut.job, id: cut.id, action, note }),
    onSuccess: (_d, action) => { toast.success(action === "approve_cut" ? "Cut approved" : "Sent back with your note"); setNote(""); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <>
      <Player cut={cut} file={cut.preview} />
      {cut.changesRequested && cut.note && <p className="text-sm text-muted-foreground">Waiting on changes: {cut.note}</p>}
      <Textarea placeholder="What should change? (only needed if you send it back)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => act.mutate("approve_cut")} disabled={act.isPending}>
          <Check className="mr-2 h-4 w-4" aria-hidden="true" />Approve cut
        </Button>
        <Button variant="outline" onClick={() => act.mutate("request_changes")} disabled={act.isPending || !note.trim()}>
          Request changes
        </Button>
      </div>
    </>
  );
}

/** Records a voice-over while the silent cut plays, so the read is timed to the picture. */
function VoiceRecorder({ cut, onDone }: { cut: ReelCutView; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [phase, setPhase] = useState<"idle" | "countdown" | "recording" | "review" | "saving">("idle");
  const [count, setCount] = useState(3);
  const [take, setTake] = useState<Blob | null>(null);
  const [takeUrl, setTakeUrl] = useState<string | null>(null);

  const stopStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  useEffect(() => () => { stopStream(); }, []);
  useEffect(() => () => { if (takeUrl) URL.revokeObjectURL(takeUrl); }, [takeUrl]);

  const stop = () => {
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
        const blob = new Blob(chunks, { type: recorder.mimeType });
        setTake(blob); setTakeUrl(URL.createObjectURL(blob)); setPhase("review");
      };
      recorderRef.current = recorder;
      setPhase("countdown");
      for (let n = 3; n > 0; n--) { setCount(n); await new Promise((r) => setTimeout(r, 800)); }
      const video = videoRef.current;
      if (video) { video.currentTime = 0; video.muted = true; video.onended = stop; await video.play().catch(() => undefined); }
      recorder.start();
      setPhase("recording");
    } catch (err) {
      stopStream(); setPhase("idle");
      toast.error(`Microphone unavailable: ${(err as Error).message}`);
    }
  };

  const playTake = () => {
    const video = videoRef.current; const audio = audioRef.current;
    if (!video || !audio) return;
    video.currentTime = 0; audio.currentTime = 0; video.muted = true;
    void video.play(); void audio.play();
  };

  const save = async () => {
    if (!take) return;
    setPhase("saving");
    const form = new FormData();
    form.set("job", cut.job); form.set("id", cut.id); form.set("audio", take, "voiceover");
    try {
      await send("/api/reels/voiceover", { method: "POST", body: form });
      toast.success("Voice-over saved. It goes to the editor for the mix and captions.");
      onDone();
    } catch (err) {
      toast.error((err as Error).message); setPhase("review");
    }
  };

  return (
    <>
      <div className="relative">
        <Player cut={cut} file={cut.preview} videoRef={videoRef} muted />
        {phase === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60 text-6xl font-semibold text-white">{count}</div>
        )}
        {phase === "recording" && <Badge variant="destructive" className="absolute left-2 top-2">● Recording</Badge>}
      </div>
      {cut.script ? (
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">{cut.script}</div>
      ) : (
        <p className="text-sm text-muted-foreground">No draft script for this cut. Talk through what the footage shows.</p>
      )}
      {takeUrl && <audio ref={audioRef} src={takeUrl} className="hidden" />}
      <div className="flex gap-2">
        {phase === "idle" && <Button className="flex-1" onClick={start}><Mic className="mr-2 h-4 w-4" aria-hidden="true" />Record voice-over</Button>}
        {phase === "countdown" && <Button className="flex-1" disabled>Get ready…</Button>}
        {phase === "recording" && <Button className="flex-1" variant="destructive" onClick={stop}><Square className="mr-2 h-4 w-4" aria-hidden="true" />Stop</Button>}
        {(phase === "review" || phase === "saving") && (
          <>
            <Button variant="outline" onClick={playTake} disabled={phase === "saving"}>Play back</Button>
            <Button variant="outline" onClick={() => { setTake(null); setTakeUrl(null); setPhase("idle"); }} disabled={phase === "saving"}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Redo
            </Button>
            <Button className="flex-1" onClick={save} disabled={phase === "saving"}>
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />{phase === "saving" ? "Saving…" : "Use this take"}
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">The cut plays silently while you record, so your read lines up with the picture. Recording stops when the video ends.</p>
    </>
  );
}

function localDateTimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FinalReview({ cut, onDone }: { cut: ReelCutView; onDone: () => void }) {
  const [caption, setCaption] = useState(cut.caption ?? "");
  const [when, setWhen] = useState(() => { const d = new Date(Date.now() + 24 * 3600_000); d.setHours(9, 0, 0, 0); return localDateTimeValue(d); });
  const [mode, setMode] = useState<"trial-manual" | "trial-auto" | "normal">("trial-manual");
  const [note, setNote] = useState("");

  const schedule = useMutation({
    mutationFn: () => send("/api/reels/schedule", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: cut.job, id: cut.id, caption, when: new Date(when).toISOString(), mode }),
    }),
    onSuccess: () => { toast.success("Approved and on the calendar"); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const sendBack = useMutation({
    mutationFn: () => patch({ job: cut.job, id: cut.id, action: "request_changes", note }),
    onSuccess: () => { toast.success("Sent back with your note"); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const busy = schedule.isPending || sendBack.isPending;

  return (
    <>
      <Player cut={cut} file={cut.final ?? cut.preview} />
      <label className="text-xs font-medium text-muted-foreground">Post caption</label>
      <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} placeholder="Caption for the post" />
      <div className="flex gap-2">
        <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="flex-1" aria-label="Post time" />
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="rounded-md border bg-background px-2 text-sm" aria-label="Reel type">
          <option value="trial-manual">Trial Reel</option>
          <option value="trial-auto">Trial, auto-graduate</option>
          <option value="normal">Normal Reel</option>
        </select>
      </div>
      <Button onClick={() => schedule.mutate()} disabled={busy || !caption.trim() || !when}>
        <Check className="mr-2 h-4 w-4" aria-hidden="true" />{schedule.isPending ? "Hosting and scheduling…" : "Approve and schedule"}
      </Button>
      <div className="flex gap-2">
        <Input placeholder="Or say what should change" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="outline" onClick={() => sendBack.mutate()} disabled={busy || !note.trim()}>Send back</Button>
      </div>
    </>
  );
}
