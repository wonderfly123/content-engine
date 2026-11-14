"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ReelCutView } from "@/lib/reels/store";
import { HookPicker, Player, Split, mediaUrl, patch, send } from "./shared";

function localDateTimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Finished video: confirm the opening text, cover and caption, then pick a time to put it on the calendar. */
export function FinalReview({ cut, onDone }: { cut: ReelCutView; onDone: () => void }) {
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
      <HookPicker options={cut.hookOptions ?? []} value={hook} onChange={setHook} />
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
