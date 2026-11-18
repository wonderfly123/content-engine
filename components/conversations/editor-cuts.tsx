"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, PenLine } from "lucide-react";
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
}

export interface EditorJobView {
  status: "queued" | "running" | "done" | "failed" | "approved";
  costUsd: number | null;
  cuts: CutView[];
  approvable: boolean;
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

/** Shown while the editor is working on a job. */
export function EditingBubble() {
  return (
    <div className="flex gap-3" role="status">
      <EditorAvatar />
      <div className="flex items-center gap-2 pt-0.5 text-[15px] text-muted-foreground">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 150, 300].map((delay) => (
            <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${delay}ms` }} />
          ))}
        </span>
        Editing…
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

function Cut({ cut, compact }: { cut: CutView; compact: boolean }) {
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
      {cut.caption && (
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
export function EditorCuts({ job, compact, onApprove, approving }: { job: EditorJobView; compact: boolean; onApprove: () => void; approving: boolean }) {
  if (job.cuts.length === 0) return job.costUsd !== null ? <p className="px-1 text-[11px] text-muted-foreground">AI cost {money(job.costUsd)}</p> : null;
  return (
    <div className="w-full space-y-3">
      <div className={cn("grid gap-4", !compact && job.cuts.length > 1 && "sm:grid-cols-2")}>
        {job.cuts.map((cut) => (
          <Cut key={cut.key} cut={cut} compact={compact} />
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
