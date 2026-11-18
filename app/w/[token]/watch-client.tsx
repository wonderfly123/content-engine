"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Loader2 } from "lucide-react";
import type { CutStage } from "@/lib/editor/approval";

interface Props {
  token: string;
  title: string;
  subtitle: string;
  videoUrl: string;
  caption: string;
  initialStage: CutStage;
  scheduledFor: string | null;
  story: boolean;
}

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Watch, approve, schedule: one step at a time, the same steps a text or the app would take. */
export function WatchClient({ token, title, subtitle, videoUrl, caption, initialStage, scheduledFor, story }: Props) {
  const [stage, setStage] = useState<CutStage>(initialStage);
  const [when, setWhen] = useState<string | null>(scheduledFor);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState("");
  const [asking, setAsking] = useState(false);
  const [pick, setPick] = useState("");
  const [copied, setCopied] = useState(false);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/w/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { stage?: CutStage; line?: string; when?: string; reply?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.stage) setStage(json.stage);
      if (json.when) setWhen(json.when);
      if (body.action === "unschedule") setWhen(null);
      setNote(json.line ?? json.reply ?? null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const btn = "flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-lg font-semibold disabled:opacity-60";
  const primary = `${btn} bg-gradient-to-br from-amber-500 to-orange-600 text-white`;
  const secondary = `${btn} border bg-background`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-5 pb-10 pt-6">
      <header>
        <p className="text-sm font-medium text-muted-foreground">Nekter · {subtitle}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
      </header>

      {/* Capped at about half the screen so the next step (Approve, Now…) stays in view on a phone. */}
      <video src={videoUrl} controls playsInline preload="metadata" className="mx-auto aspect-[9/16] max-h-[52dvh] w-auto max-w-full rounded-2xl bg-black object-contain" />

      {!story && caption && (
        <section className="rounded-xl border p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Caption</span>
            <button
              type="button"
              className="flex items-center gap-1 text-sm"
              onClick={() => void navigator.clipboard?.writeText(caption).then(() => setCopied(true))}
            >
              <Copy className="h-4 w-4" aria-hidden="true" /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{caption}</p>
        </section>
      )}

      {stage === "ready" && !asking && (
        <section className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Happy with it? Approve it, then pick when it posts. Or tell the editor what to change.</p>
          <button type="button" className={primary} disabled={busy} onClick={() => void act({ action: "approve" })}>
            {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />} Approve
          </button>
          <button type="button" className={secondary} disabled={busy} onClick={() => setAsking(true)}>
            Ask for changes
          </button>
        </section>
      )}

      {stage === "ready" && asking && (
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">What should change?</span>
            <textarea
              value={changes}
              onChange={(e) => setChanges(e.target.value)}
              rows={3}
              placeholder='e.g. "Start with the sign, and make it shorter."'
              className="rounded-xl border bg-background p-3 text-base"
            />
          </label>
          <button
            type="button"
            className={primary}
            disabled={busy || !changes.trim()}
            onClick={() => void act({ action: "changes", body: changes }).then((ok) => ok && (setAsking(false), setChanges("")))}
          >
            {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />} Send to the editor
          </button>
          <button type="button" className="text-sm text-muted-foreground" onClick={() => setAsking(false)}>
            Back
          </button>
        </section>
      )}

      {stage === "approved" && (
        <section className="flex flex-col gap-3">
          <p className="font-semibold">Approved. When should it post?</p>
          <button type="button" className={primary} disabled={busy} onClick={() => void act({ action: "schedule", when: "now" })}>
            Now
          </button>
          <button type="button" className={secondary} disabled={busy} onClick={() => void act({ action: "schedule", when: "tonight" })}>
            Tonight at 7 PM
          </button>
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-14 min-w-0 flex-1 rounded-2xl border bg-background px-3 text-base"
            />
            <button
              type="button"
              className="h-14 shrink-0 rounded-2xl border px-4 font-semibold disabled:opacity-60"
              disabled={busy || !pick}
              onClick={() => void act({ action: "schedule", when: new Date(pick).toISOString() })}
            >
              Schedule
            </button>
          </div>
        </section>
      )}

      {stage === "scheduled" && (
        <section className="flex flex-col gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            {when ? `Scheduled for ${fmt(when)}` : "Scheduled"}
          </p>
          <p className="text-sm">We&apos;ll text you the link once it&apos;s live.</p>
          <button type="button" className="self-start rounded-md border border-current px-3 py-1.5 text-sm" disabled={busy} onClick={() => void act({ action: "unschedule" })}>
            Unschedule
          </button>
        </section>
      )}

      {stage === "posted" && <p className="rounded-xl border p-4 font-semibold">This one is live. Check the text for the link.</p>}

      {note && stage !== "scheduled" && <p className="text-sm text-muted-foreground">{note}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </main>
  );
}
