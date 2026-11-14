"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NO_TRIM, isEdited, trimFromKeep, type TrimState } from "@/lib/reels/edits";
import type { ReelCutView } from "@/lib/reels/store";
import { ClipEditor } from "./clip-editor";
import { HookPicker, Player, Split, patch, send } from "./shared";
import { TrimEditor } from "./trim-editor";
import { useEditedPlayback } from "./use-edited-playback";
import { VoiceRecorder } from "./voice-recorder";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold"><span className="mr-2 text-muted-foreground">{n}</span>{title}</h3>
      {children}
    </section>
  );
}

/**
 * The first review, all in one place: watch and lightly edit the cut, record a voice-over or choose none,
 * pick the opening text, then accept. Everything is sent together on accept.
 */
export function ReviewAndEdit({ cut, onDone }: { cut: ReelCutView; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onEnd = useRef<(() => void) | null>(null);
  const [trim, setTrim] = useState<TrimState>(() => (cut.edits ? trimFromKeep(cut.edits.keep) : NO_TRIM));
  const { time, duration, keep } = useEditedPlayback(videoRef, trim, onEnd);
  // The editor's suggestion is only a starting point; the reviewer decides here.
  const [voice, setVoice] = useState(cut.mode === "voice");
  const [take, setTake] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [hook, setHook] = useState(cut.hook ?? cut.hookBurned ?? "");
  const [note, setNote] = useState("");
  // Cuts that come with their clip list open in the full-screen clip editor; older ones only get the simple trim.
  const [editingClips, setEditingClips] = useState(false);
  const takeLocksEdit = recording || (voice && Boolean(take));

  const accept = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("job", cut.job);
      form.set("id", cut.id);
      form.set("voice", voice ? "1" : "0");
      form.set("hook", hook.trim());
      if (isEdited(keep, duration)) form.set("edits", JSON.stringify(keep));
      if (voice && take) form.set("audio", take, "voiceover");
      return send("/api/reels/accept", { method: "POST", body: form });
    },
    onSuccess: () => { toast.success("Accepted. You'll see it again in Final review."); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const sendBack = useMutation({
    mutationFn: () => patch({ job: cut.job, id: cut.id, action: "request_changes", note }),
    onSuccess: () => { toast.success("Sent back with your note"); setNote(""); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const busy = accept.isPending || sendBack.isPending;
  const blocked = duration <= 0 ? "Loading the video…" : keep.length === 0 ? "Nothing is left of the video." : voice && !take ? "Record your voice-over, or choose No voice-over." : null;

  const choose = (on: boolean) => {
    setVoice(on);
    if (videoRef.current && !recording) videoRef.current.muted = false;
  };
  const choice = (on: boolean, label: string) => (
    <button type="button" role="radio" aria-checked={voice === on} disabled={recording || busy} onClick={() => choose(on)}
      className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${voice === on ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"}`}>
      {label}
    </button>
  );

  return (
    <Split video={
      <>
        <Player cut={cut} file={cut.preview} videoRef={videoRef} />
        {cut.edl ? (
          <>
            <Button variant="outline" disabled={takeLocksEdit || busy} onClick={() => { videoRef.current?.pause(); setEditingClips(true); }}>
              <Maximize2 className="mr-2 h-4 w-4" aria-hidden="true" />Edit clips
            </Button>
            <p className="text-xs text-muted-foreground">
              {takeLocksEdit ? "Your voice-over is timed to this cut. Redo the take to edit the clips." : cut.original ? "This is your edit of the cut." : "Opens the full-screen editor: trim, extend, move, split or delete each clip."}
            </p>
            <ClipEditor cut={cut} open={editingClips} onClose={() => setEditingClips(false)} onSaved={onDone} />
          </>
        ) : (
          <TrimEditor videoRef={videoRef} time={time} duration={duration} keep={keep} trim={trim} onChange={setTrim} locked={takeLocksEdit} />
        )}
      </>
    }>
      {cut.changesRequested && cut.note && <p className="text-sm text-muted-foreground">Waiting on changes: {cut.note}</p>}
      <Step n={1} title="Watch and edit">
        <p className="text-xs text-muted-foreground">{cut.edl ? "Use Edit clips under the video to change any clip. Skip this if the cut is good as it is." : "Trim the start or end, or cut a section out, with the buttons under the video. Skip this if the cut is good as it is."}</p>
      </Step>
      <Step n={2} title="Voice-over">
        <div className="flex gap-2" role="radiogroup" aria-label="Voice-over">
          {choice(true, "Voice-over")}
          {choice(false, "No voice-over")}
        </div>
        {voice && (
          <VoiceRecorder videoRef={videoRef} startAt={keep[0]?.from ?? 0} onEnd={onEnd} script={cut.script} take={take} onTake={setTake} onRecordingChange={setRecording} disabled={busy || duration <= 0 || keep.length === 0} />
        )}
      </Step>
      <Step n={3} title="Opening text">
        <p className="text-xs text-muted-foreground">On screen for the first seconds of the video. Optional{voice ? ", and separate from the captions" : ""}.</p>
        <HookPicker options={cut.hookOptions ?? []} value={hook} onChange={setHook} />
      </Step>
      <Button onClick={() => accept.mutate()} disabled={busy || recording || blocked !== null}>
        <Check className="mr-2 h-4 w-4" aria-hidden="true" />{accept.isPending ? "Saving…" : "Accept"}
      </Button>
      {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
      <div className="flex gap-2">
        <Input placeholder="Or say what should change" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="outline" onClick={() => sendBack.mutate()} disabled={busy || recording || !note.trim()}>Send back</Button>
      </div>
    </Split>
  );
}
