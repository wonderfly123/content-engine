"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { useClipUploads, type UploadItem } from "@/components/conversations/use-clip-uploads";
import { Toaster } from "@/components/ui/sonner";
import { formatBytes } from "@/lib/media/rules";

const pct = (i: UploadItem) => (i.file.size ? Math.min(100, Math.round((i.uploaded / i.file.size) * 100)) : 0);

const LENGTHS = [
  { value: undefined, label: "Editor's pick" },
  { value: 15, label: "15s" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
] as const;

/**
 * The phone page behind an upload link: say what it's about, pick clips, watch them go up, then
 * send it all to the editor in one go (the clips and the description arrive as one message).
 */
export function UploadLinkClient({ token, conversationId, title, named }: { token: string; conversationId: string; title: string; named: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const { items, uploading, addFiles, cancel, resume, retry, report } = useClipUploads(conversationId, () => undefined, `/api/u/${token}/uploads`, {
    autoReport: false,
  });
  const [description, setDescription] = useState("");
  const [seconds, setSeconds] = useState<15 | 30 | 60 | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // From the tap on "Add clips" until the phone hands the files over (it copies them first, which can take minutes).
  const [picking, setPicking] = useState(false);
  const [nothingPicked, setNothingPicked] = useState(false);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const cancelled = () => setPicking(false);
    el.addEventListener("cancel", cancelled);
    return () => el.removeEventListener("cancel", cancelled);
  }, []);
  const done = items.filter((i) => i.status === "done");
  const unsent = done.length - sent;
  const allDone = items.length > 0 && !uploading && items.every((i) => i.status === "done" || i.status === "cancelled" || i.status === "failed");
  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await report({ description: description.trim() || undefined, seconds });
      setSent(done.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 pb-10 pt-8">
      <header>
        <p className="text-sm font-medium text-muted-foreground">Nekter</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-muted-foreground">Pick the clips from your camera roll. They upload at full quality.</p>
      </header>

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50">
        <p className="font-semibold">Clips saved in iCloud take longer</p>
        <p className="mt-1 text-sm">
          Your phone has to download them before this page gets anything. That happens in the photo picker and can take a few minutes. Adding one clip at a time
          works best.
        </p>
        <details className="group mt-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium underline underline-offset-2 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" />
            Clips not showing up? Try this
          </summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li>Add one clip at a time: pick one, tap the check, wait for it to appear here, then tap Add more clips.</li>
            <li>If a clip shows a spinning circle in the picker, wait for it to finish, then tap the check again.</li>
            <li>If the check does nothing, close the picker with the X, wait a moment, and tap Add clips again.</li>
            <li>Open the clip in the Photos app and let it play through, so it is fully on your phone. Then come back and pick it.</li>
            <li>Stay on Wi-Fi and keep this page open while clips load.</li>
            <li>Check the phone has free space: Settings, General, iPhone Storage.</li>
            <li>Still stuck? Open this link in Safari.</li>
          </ol>
        </details>
      </section>

      {!named && sent === 0 && (
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">What&apos;s this one about?</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1500}
              placeholder="e.g. The cider stand we built for Bloomingdale's opening day. Show the crowd and end on the sign."
              className="rounded-xl border bg-background p-3 text-base"
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Length</span>
            <div className="flex flex-wrap gap-2">
              {LENGTHS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  onClick={() => setSeconds(l.value)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${seconds === l.value ? "border-orange-500 bg-orange-50 text-orange-900 dark:bg-orange-950/40 dark:text-orange-100" : ""}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <input
        ref={input}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          setPicking(false);
          setNothingPicked(files.length === 0);
          addFiles(files);
          e.target.value = "";
        }}
      />
      <Toaster position="top-center" duration={10000} />
      <button
        type="button"
        onClick={() => {
          setPicking(true);
          setNothingPicked(false);
          input.current?.click();
        }}
        className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-lg font-semibold text-white shadow-md active:scale-[0.99]"
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
        {items.length ? "Add more clips" : "Add clips"}
      </button>

      {picking && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          Getting your clips from your phone. Long clips, and clips saved in iCloud, can take a few minutes to show up here. Keep this page open.
        </p>
      )}
      {nothingPicked && (
        <p className="text-sm text-destructive">Your phone didn&apos;t hand over any clips. Try again one clip at a time, and check the phone has free space.</p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id} className="rounded-xl border bg-background p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.status === "done"
                      ? `Uploaded · ${formatBytes(i.file.size)}`
                      : i.status === "failed"
                        ? i.error ?? "Didn't upload."
                        : i.status === "cancelled"
                          ? "Cancelled"
                          : i.status === "resumable"
                            ? "Paused, tap resume"
                            : `${pct(i)}% of ${formatBytes(i.file.size)}`}
                  </p>
                </div>
                {i.status === "done" && <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-label="Uploaded" />}
                {(i.status === "uploading" || i.status === "queued") && (
                  <button type="button" onClick={() => cancel(i.id)} className="shrink-0 rounded-full p-2 text-muted-foreground" aria-label="Cancel">
                    <X className="h-4 w-4" />
                  </button>
                )}
                {i.status === "resumable" && (
                  <button type="button" onClick={() => resume(i.id)} className="shrink-0 rounded-md border px-3 py-1.5 text-sm">
                    Resume
                  </button>
                )}
                {i.status === "failed" && (
                  <button type="button" onClick={() => retry(i.id)} className="shrink-0 rounded-full p-2" aria-label="Try again">
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
              </div>
              {(i.status === "uploading" || i.status === "queued") && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-orange-500 transition-[width]" style={{ width: `${pct(i)}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {uploading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Keep this page open until they finish.
        </p>
      )}
      {allDone && unsent > 0 && (
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-lg font-semibold text-background disabled:opacity-60"
        >
          {sending && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          Send {unsent} {unsent === 1 ? "clip" : "clips"} to the editor
        </button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {sent > 0 && unsent === 0 && !uploading && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100">
          <p className="font-semibold">Sent to the editor.</p>
          <p className="mt-1 text-sm">We&apos;ll text you what we&apos;re making, then again when the first cut is ready. You can close this page.</p>
        </div>
      )}
    </main>
  );
}
