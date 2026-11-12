"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Maximize2, Mic, RotateCcw, Square, Upload } from "lucide-react";
import { toast } from "sonner";
import { useBrandStore } from "@/lib/stores/brand-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ReelCutView } from "@/lib/reels/store";

const STAGES = {
  cuts: { title: "Cut review", blurb: "Watch each cut. Approve it, or say what should change.", show: ["cut_review"] },
  voiceover: { title: "Voice-over queue", blurb: "Approved voice-led cuts waiting for your recording.", show: ["voiceover"] },
  final: { title: "Final review", blurb: "Finished videos. Confirm the cover and caption, then pick a time to put them on the calendar.", show: ["final_review", "editing", "scheduled"] },
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
  const [openKey, setOpenKey] = useState<string | null>(null);

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
  // The dialog follows the list: when a cut leaves this stage (approved, sent back), it closes by itself.
  const openCut = cuts.find((c) => keyOf(c) === openKey) ?? null;

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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {cuts.map((cut) => (
          <Card key={keyOf(cut)} className="overflow-hidden">
            <CardContent className="flex flex-col gap-2 p-3">
              <button type="button" onClick={() => setOpenKey(keyOf(cut))} className="block w-full" aria-label={`Open ${cut.title}`}>
                <video src={`${mediaUrl(cut, cut.final ?? cut.preview)}#t=${(cut.coverAt ?? 1).toFixed(2)}`} muted playsInline preload="metadata" className="aspect-[9/16] w-full rounded-md bg-black object-cover" />
              </button>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{cut.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{cut.job} · {cut.mode === "voice" ? "voice-led" : "music-led"}</p>
                </div>
                <button type="button" onClick={() => setOpenKey(keyOf(cut))} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Expand ${cut.title}`}>
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <Button size="sm" variant={cut.stage === "editing" || cut.stage === "scheduled" ? "outline" : "default"} onClick={() => setOpenKey(keyOf(cut))}>{TILE_ACTION[cut.stage] ?? "Open"}</Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={Boolean(openCut)} onOpenChange={(o) => { if (!o) setOpenKey(null); }}>
        <DialogContent className="max-h-[94vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-4xl">
          {openCut && (
            <>
              <DialogHeader>
                <DialogTitle>{openCut.title}</DialogTitle>
                <DialogDescription>{openCut.job} · {openCut.seconds}s · {openCut.mode === "voice" ? "voice-led" : "music-led"}</DialogDescription>
              </DialogHeader>
              {openCut.stage === "cut_review" && <CutReview key={keyOf(openCut)} cut={openCut} onDone={refresh} />}
              {openCut.stage === "voiceover" && <VoiceRecorder key={keyOf(openCut)} cut={openCut} onDone={refresh} />}
              {openCut.stage === "final_review" && <FinalReview key={keyOf(openCut)} cut={openCut} onDone={refresh} />}
              {openCut.stage === "editing" && (
                <Split video={<Player cut={openCut} file={openCut.preview} />}>
                  <Badge variant="outline" className="w-fit">With the editor</Badge>
                  <p className="text-sm text-muted-foreground">
                    {openCut.note ? `Changes requested: ${openCut.note}` : openCut.voiceover ? "Voice-over recorded. Waiting for the mix and captions." : "Waiting for the finished file and caption."}
                  </p>
                </Split>
              )}
              {openCut.stage === "scheduled" && (
                <Split video={<Player cut={openCut} file={openCut.final ?? openCut.preview} />}>
                  <Badge className="w-fit">Scheduled</Badge>
                  <p className="text-sm text-muted-foreground">
                    {openCut.scheduledFor ? new Date(openCut.scheduledFor).toLocaleString() : ""} · {openCut.trial ? "trial Reel" : "normal Reel"}. See the Calendar.
                  </p>
                  {openCut.caption && <p className="whitespace-pre-wrap text-sm">{openCut.caption}</p>}
                </Split>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const keyOf = (cut: ReelCutView) => `${cut.job}/${cut.id}`;
const TILE_ACTION: Record<string, string> = { cut_review: "Review cut", voiceover: "Record", final_review: "Review and schedule", editing: "With the editor", scheduled: "Scheduled" };

/** Video on the left, everything else on the right; stacks on a narrow screen. */
function Split({ video, children }: { video: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      <div>{video}</div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
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
    <Split video={<Player cut={cut} file={cut.preview} />}>
      {cut.changesRequested && cut.note && <p className="text-sm text-muted-foreground">Waiting on changes: {cut.note}</p>}
      <Textarea placeholder="What should change? (only needed if you send it back)" value={note} onChange={(e) => setNote(e.target.value)} rows={5} />
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => act.mutate("approve_cut")} disabled={act.isPending}>
          <Check className="mr-2 h-4 w-4" aria-hidden="true" />Approve cut
        </Button>
        <Button variant="outline" onClick={() => act.mutate("request_changes")} disabled={act.isPending || !note.trim()}>
          Request changes
        </Button>
      </div>
    </Split>
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
    <Split video={
      <div className="relative">
        <Player cut={cut} file={cut.preview} videoRef={videoRef} muted />
        {phase === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60 text-6xl font-semibold text-white">{count}</div>
        )}
        {phase === "recording" && <Badge variant="destructive" className="absolute left-2 top-2">● Recording</Badge>}
      </div>
    }>
      {cut.script ? (
        <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">{cut.script}</div>
      ) : (
        <p className="text-sm text-muted-foreground">No draft script for this cut. Talk through what the footage shows.</p>
      )}
      {takeUrl && <audio ref={audioRef} src={takeUrl} className="hidden" />}
      <div className="flex flex-wrap gap-2">
        {phase === "idle" && <Button className="flex-1" onClick={start}><Mic className="mr-2 h-4 w-4" aria-hidden="true" />Record voice-over</Button>}
        {phase === "countdown" && <Button className="flex-1" disabled>Get ready…</Button>}
        {phase === "recording" && <Button className="flex-1" variant="destructive" onClick={stop}><Square className="mr-2 h-4 w-4" aria-hidden="true" />Stop</Button>}
        {(phase === "review" || phase === "saving") && (
          <>
            <Button className="flex-1" variant="outline" onClick={playTake} disabled={phase === "saving"}>Play back</Button>
            <Button className="flex-1" variant="outline" onClick={() => { setTake(null); setTakeUrl(null); setPhase("idle"); }} disabled={phase === "saving"}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Redo
            </Button>
            <Button className="w-full" onClick={save} disabled={phase === "saving"}>
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />{phase === "saving" ? "Saving…" : "Use this take"}
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">The cut plays silently while you record, so your read lines up with the picture. Recording stops when the video ends.</p>
    </Split>
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
  // The cover is the frame people see on the profile grid. It must be confirmed here, even when the editor suggested one.
  const [coverAt, setCoverAt] = useState<number | null>(cut.coverAt ?? null);
  const [coverConfirmed, setCoverConfirmed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const file = cut.final ?? cut.preview;

  const schedule = useMutation({
    mutationFn: () => send("/api/reels/schedule", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: cut.job, id: cut.id, caption, when: new Date(when).toISOString(), mode, coverAt, hook: hook.trim() }),
    }),
    onSuccess: () => { toast.success(textChanges ? "Approved. The editor adds the text, then it goes on the calendar." : "Approved and on the calendar"); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  // Opening on-screen text: one of the editor's drafts, the reviewer's own words, or none. It travels with the approval.
  const burned = cut.hookBurned ?? "";
  const [hook, setHook] = useState(cut.hook ?? burned);
  const textChanges = hook.trim() !== burned;
  const sendBack = useMutation({
    mutationFn: () => patch({ job: cut.job, id: cut.id, action: "request_changes", note }),
    onSuccess: () => { toast.success("Sent back with your note"); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const busy = schedule.isPending || sendBack.isPending;

  return (
    <Split video={<Player cut={cut} file={file} videoRef={videoRef} />}>
      <label className="text-xs font-medium text-muted-foreground">Opening text (first seconds of the video)</label>
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Opening text">
        {["", ...(cut.hookOptions ?? [])].map((o, i) => (
          <button key={o || "none"} type="button" role="radio" aria-checked={hook.trim() === o} onClick={() => setHook(o)}
            className={`rounded-md border px-3 py-1.5 text-left text-sm ${hook.trim() === o ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"}`}>
            {o ? <><span className="mr-2 text-muted-foreground">{i}</span>{o}</> : <span className="text-muted-foreground">No opening text</span>}
          </button>
        ))}
      </div>
      <Input value={hook} onChange={(e) => setHook(e.target.value)} maxLength={120} placeholder="Or write your own" aria-label="Write your own opening text" />
      <p className="text-xs text-muted-foreground">
        {textChanges
          ? hook.trim() ? "Not on the video yet. When you approve, the editor adds this text and then puts it on the calendar at the time below." : "When you approve, the editor takes the text off and then puts it on the calendar."
          : burned ? `On the video now: "${burned}"` : "No text on the video."}
      </p>
      <label className="text-xs font-medium text-muted-foreground">Cover (thumbnail)</label>
      <div className="flex items-center gap-3">
        {coverAt === null ? (
          <div className="flex aspect-[9/16] w-16 shrink-0 items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">none</div>
        ) : (
          <video key={coverAt} src={`${mediaUrl(cut, file)}#t=${coverAt.toFixed(2)}`} muted playsInline preload="metadata" className="aspect-[9/16] w-16 shrink-0 rounded-md bg-black object-cover" aria-label="Chosen cover frame" />
        )}
        <div className="flex flex-1 flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {coverAt === null ? "Pause the video on the frame you want as the cover." : coverConfirmed ? `Cover confirmed at ${coverAt.toFixed(1)}s.` : `Suggested cover at ${coverAt.toFixed(1)}s. Confirm it or pick another frame.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { setCoverAt(Number((videoRef.current?.currentTime ?? 0).toFixed(2))); setCoverConfirmed(true); }}>Use current frame</Button>
            {coverAt !== null && !coverConfirmed && <Button size="sm" onClick={() => setCoverConfirmed(true)}>Confirm cover</Button>}
          </div>
        </div>
      </div>
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
      <Button onClick={() => schedule.mutate()} disabled={busy || !caption.trim() || !when || coverAt === null || !coverConfirmed}>
        <Check className="mr-2 h-4 w-4" aria-hidden="true" />{schedule.isPending ? (textChanges ? "Saving…" : "Hosting and scheduling…") : "Approve and schedule"}
      </Button>
      <div className="flex gap-2">
        <Input placeholder="Or say what should change" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="outline" onClick={() => sendBack.mutate()} disabled={busy || !note.trim()}>Send back</Button>
      </div>
    </Split>
  );
}
