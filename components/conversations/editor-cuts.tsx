"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Download, Loader2, Music, PenLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CutView {
  key: string;
  title: string;
  seconds: number;
  previewId: string;
  hookOptions: string[];
  caption: string;
  /** The track under the cut and the same cut without it; null (or absent, older cuts) when silent. */
  music?: { title: string; silentId: string } | null;
}

export interface Step {
  label: string;
  at: string;
}

export interface EditorJobView {
  /** The job's id: a campaign chat approves one plan item's job by id. */
  id?: string;
  status: "queued" | "running" | "done" | "failed" | "approved";
  costUsd: number | null;
  cuts: CutView[];
  approvable: boolean;
  steps?: Step[];
  seconds?: number | null;
}

/** "45s", "6m", "6m 20s". */
const took = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  return s % 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 60)}m`;
};

/** The step list, like Claude's: one line per step, the current one spinning. */
function StepList({ steps, live }: { steps: Step[]; live: boolean }) {
  return (
    <ol className="mt-2 space-y-1.5 border-l pl-4">
      {steps.map((st, i) => {
        const current = live && i === steps.length - 1;
        return (
          <li key={`${i}-${st.label}`} className="flex items-center gap-2 text-sm text-muted-foreground">
            {current ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className={cn(current && "text-foreground")}>{st.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** "Worked for 6m · 9 steps", collapsed under a finished edit; tap to see what it did. */
export function WorkedFor({ steps, seconds }: { steps: Step[]; seconds: number | null }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        {seconds ? `Worked for ${took(seconds)}` : "Worked"} · {steps.length} {steps.length === 1 ? "step" : "steps"}
      </button>
      {open && <StepList steps={steps} live={false} />}
    </div>
  );
}

/** "0:15", "1:02". */
const length = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const money = (usd: number) => (usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);

/** The N avatar, matching the editor's chat bubbles. */
export function EditorAvatar() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-xs font-bold text-white" aria-hidden="true">
      N
    </span>
  );
}

/** Shown while the editor works: the step it is on, the time so far, and every step when opened. */
export function EditingBubble({ steps = [], startedAt = null }: { steps?: Step[]; startedAt?: string | null }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const current = steps[steps.length - 1]?.label ?? "Getting started";
  const elapsed = startedAt ? took((now - Date.parse(startedAt)) / 1000) : null;
  return (
    <div className="flex gap-3" role="status">
      <EditorAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          disabled={steps.length === 0}
          className="flex items-center gap-2 text-left text-[15px] text-muted-foreground enabled:hover:text-foreground"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <span>
            <span className="text-foreground">{current}…</span>
            {elapsed && <span> · {elapsed}</span>}
          </span>
          {steps.length > 0 && (open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />)}
        </button>
        {open && <StepList steps={steps} live />}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy.");
        }
      }}
    >
      {copied ? <Check className="mr-1 h-3 w-3" aria-hidden="true" /> : <Copy className="mr-1 h-3 w-3" aria-hidden="true" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Cut({ cut, compact, story }: { cut: CutView; compact: boolean; story: boolean }) {
  return (
    <div className="space-y-2">
      <video
        controls
        playsInline
        preload="metadata"
        src={`/api/media/${cut.previewId}`}
        className={cn("aspect-[9/16] w-auto max-w-full rounded-2xl bg-black", compact ? "max-h-[50vh]" : "max-h-[60vh]")}
      />
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <p className="truncate text-sm font-medium" title={cut.title}>
          {cut.title}
        </p>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{length(cut.seconds)}</span>
      </div>
      {cut.music && (
        <p className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground" title={cut.music.title}>
          <Music className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{cut.music.title}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-xs">
        <a href={`/api/media/${cut.previewId}?download=1`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download
        </a>
        {cut.music && (
          <a
            href={`/api/media/${cut.music.silentId}?download=1`}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            title="Instagram can mute commercial music; this copy has no sound, to add one in Instagram"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Without music
          </a>
        )}
      </div>
      {/* Stories have no caption on Instagram, so none is shown for them. */}
      {cut.caption && !story && (
        <div className="rounded-2xl border px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Caption</span>
            <CopyButton text={cut.caption} />
          </div>
          <p className="whitespace-pre-wrap break-words text-sm">{cut.caption}</p>
        </div>
      )}
      {cut.hookOptions.length > 0 && (
        <details className="group rounded-lg px-0.5 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            Hook options ({cut.hookOptions.length})
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {cut.hookOptions.map((hook, i) => (
              <li key={i} className="break-words">
                {hook}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The cuts an editor reply carries: inline previews, captions, hooks, its AI cost, Approve. */
export function EditorCuts({
  job,
  compact,
  story = false,
  onApprove,
  approving,
}: {
  job: EditorJobView;
  compact: boolean;
  story?: boolean;
  onApprove: () => void;
  approving: boolean;
}) {
  const worked = job.steps?.length ? <WorkedFor steps={job.steps} seconds={job.seconds ?? null} /> : null;
  if (job.cuts.length === 0)
    return (
      <>
        {worked}
        {job.costUsd !== null && <p className="px-1 text-[11px] text-muted-foreground">AI cost {money(job.costUsd)}</p>}
      </>
    );
  return (
    <div className="w-full space-y-3">
      {worked}
      <div className={cn("grid gap-4", !compact && job.cuts.length > 1 && "sm:grid-cols-2")}>
        {job.cuts.map((cut) => (
          <Cut key={cut.key} cut={cut} compact={compact} story={story} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {job.status === "approved" ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4" aria-hidden="true" />
            Approved
          </span>
        ) : (
          <Button size="sm" className="rounded-full" onClick={onApprove} disabled={!job.approvable || approving} title={job.approvable ? undefined : "A newer version replaced this one"}>
            <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {approving ? "Approving…" : "Approve"}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="rounded-full" disabled title="Coming next">
          <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Open in editor
        </Button>
        {job.costUsd !== null && <span className="text-[11px] text-muted-foreground">AI cost {money(job.costUsd)}</span>}
      </div>
    </div>
  );
}
