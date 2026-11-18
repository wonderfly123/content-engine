"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarCheck, ChevronDown, ChevronRight, Clapperboard, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "planned" | "editing" | "ready" | "approved" | "scheduled" | "posted";

interface Item {
  id: string;
  number: number;
  title: string;
  angle: string;
  hook: string;
  lengthSec: number;
  format: string;
  music: string;
  postAt: string;
  status: Status;
  clips: Array<{ assetId: string; label: string }>;
}

export interface CampaignData {
  name: string;
  theme: string;
  goal: string;
  audience: string;
  planWritten: boolean;
  calendarApproved: boolean;
  items: Item[];
  canMakeNext: boolean;
  active: number | null;
}

const STATUS: Record<Status, { label: string; className: string }> = {
  planned: { label: "Planned", className: "text-muted-foreground" },
  editing: { label: "Editing", className: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" },
  ready: { label: "Ready", className: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" },
  scheduled: { label: "Scheduled", className: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" },
  posted: { label: "Posted", className: "bg-foreground text-background" },
};

async function fetchCampaign(id: string): Promise<CampaignData | null> {
  const res = await fetch(`/api/conversations/${id}/campaign`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { campaign: CampaignData | null }).campaign;
}

/** The plan's query, shared with the thread view so a sent message refreshes it. */
export const campaignKey = (conversationId: string) => ["campaign", conversationId];

/**
 * The campaign plan pinned at the top of a campaign chat: each video's status, its brief when
 * opened, and the two buttons that move it on (approve the calendar, make the next video).
 */
export function CampaignPlan({ conversationId, closed, onChange }: { conversationId: string; closed: boolean; onChange: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: campaignKey(conversationId),
    queryFn: () => fetchCampaign(conversationId),
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "editing") ? 5_000 : 15_000),
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"approve_plan" | "next" | null>(null);

  const act = async (action: "approve_plan" | "next") => {
    setBusy(action);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json().catch(() => ({}))) as { campaign?: CampaignData; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.campaign) qc.setQueryData(campaignKey(conversationId), json.campaign);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data || !data.planWritten || data.items.length === 0) {
    return (
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm text-muted-foreground sm:px-6">
        <Megaphone className="h-4 w-4 shrink-0" aria-hidden="true" />
        Campaign plan: brainstorm with the editor below, then say &ldquo;make the plan&rdquo;.
      </div>
    );
  }

  const done = data.items.filter((i) => i.status === "scheduled" || i.status === "posted").length;
  return (
    <div className="border-b bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
          <span className="truncate font-medium">{data.name || "Campaign plan"}</span>
          <span className="shrink-0 text-muted-foreground">
            · {data.items.length} videos · {done} scheduled
            {data.active ? ` · #${data.active} in progress` : ""}
          </span>
        </button>
        {!closed && !data.calendarApproved && (
          <Button size="sm" variant="outline" className="rounded-full" disabled={busy !== null} onClick={() => void act("approve_plan")}>
            <CalendarCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {busy === "approve_plan" ? "Approving…" : "Approve plan & calendar"}
          </Button>
        )}
        {!closed && data.canMakeNext && (
          <Button size="sm" className="rounded-full" disabled={busy !== null} onClick={() => void act("next")}>
            <Clapperboard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {busy === "next" ? "Starting…" : "Make next video"}
          </Button>
        )}
      </div>
      {open && (
        <ol className="max-h-[40dvh] space-y-1 overflow-y-auto px-4 pb-3 sm:px-6" aria-label="Videos in the plan">
          {data.items.map((item) => (
            <PlanRow key={item.id} item={item} />
          ))}
        </ol>
      )}
    </div>
  );
}

function PlanRow({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[item.status];
  return (
    <li className="rounded-lg bg-background px-3 py-2 text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <span className="w-7 shrink-0 tabular-nums text-muted-foreground">#{item.number}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {item.lengthSec}s {item.format} · {format(new Date(item.postAt), "EEE MMM d, h:mm a")}
        </span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", status.className)}>{status.label}</span>
      </button>
      {open && (
        <dl className="mt-2 grid gap-1 pl-9 text-xs text-muted-foreground">
          <div className="sm:hidden">
            {item.lengthSec}s {item.format} · {format(new Date(item.postAt), "EEE MMM d, h:mm a")}
          </div>
          {item.angle && <Field label="Angle" value={item.angle} />}
          {item.hook && <Field label="Hook" value={item.hook} />}
          {item.music && <Field label="Music" value={item.music} />}
          <Field label="Clips" value={item.clips.length ? item.clips.map((c) => c.label).join(", ") : "From this chat's uploads"} />
        </dl>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-medium text-foreground">{label}: </dt>
      <dd className="inline">{value}</dd>
    </div>
  );
}
