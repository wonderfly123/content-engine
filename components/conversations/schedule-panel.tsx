"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface View {
  stage: "ready" | "approved" | "scheduled" | "posted" | null;
  when: string | null;
}

/**
 * After a cut is approved: when it posts (Now / Tonight / a time), then Unschedule until it's live.
 * The same step the watch page and a text take (lib/editor/approval.ts).
 */
export function SchedulePanel({ conversationId, onChange }: { conversationId: string; onChange: () => void }) {
  const qc = useQueryClient();
  const key = ["schedule", conversationId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<View> => (await fetch(`/api/conversations/${conversationId}/schedule`, { cache: "no-store" })).json(),
    refetchInterval: 15_000,
  });
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);

  const call = async (method: "POST" | "DELETE", when?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/schedule`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: when ? JSON.stringify({ when }) : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as View & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      qc.setQueryData(key, json);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (data?.stage === "approved") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4" aria-hidden="true" /> Approved. When should it post?
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void call("POST", "now")}>Now</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void call("POST", "tonight")}>Tonight at 7 PM</Button>
          <input type="datetime-local" value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm" />
          <Button size="sm" variant="outline" disabled={busy || !pick} onClick={() => void call("POST", new Date(pick).toISOString())}>Schedule</Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }
  if (data?.stage === "scheduled") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
        <span className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Scheduled{data.when ? ` for ${new Date(data.when).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void call("DELETE")}>Unschedule</Button>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </div>
    );
  }
  return null;
}
