"use client";

import { TextEditorBanner, type TextingInfo } from "@/components/conversations/text-editor-banner";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";
import { Monitor, MessagesSquare, Smartphone } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrandStore } from "@/lib/stores/brand-store";
import { cn } from "@/lib/utils";
import { kindLabel, NewThreadButtons, type Channel, type Kind } from "./shared";

interface ThreadRow {
  id: string;
  kind: Kind;
  status: "open" | "closed";
  startedVia: Channel;
  brandId: string | null;
  mine: boolean;
  createdAt: string;
  closedReason: string | null;
  lastMessage: { body: string; direction: "in" | "out"; channel: Channel; createdAt: string } | null;
}

async function fetchThreads(brandId: string): Promise<{ threads: ThreadRow[] } & TextingInfo> {
  const res = await fetch(`/api/conversations?${new URLSearchParams({ brandId })}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type Filter = "all" | Channel;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "sms", label: "By text" },
  { value: "app", label: "In the app" },
];
const FILTER_KEY = "nekter.conversations.filter";

/** Where a thread was started, as a clear label: texted threads stand out from app ones. */
export function StartedVia({ channel }: { channel: Channel }) {
  const text = channel === "sms";
  const Icon = text ? Smartphone : Monitor;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        text ? "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200" : "text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {text ? "By text" : "In the app"}
    </span>
  );
}

/** The active brand's conversations with the editor, newest first, filterable by where they started. */
export function ThreadList() {
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FILTER_KEY);
      if (saved === "sms" || saved === "app") setFilter(saved);
    } catch {
      /* no storage: start on All */
    }
  }, []);
  const choose = (f: Filter) => {
    setFilter(f);
    try {
      window.localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* ignore */
    }
  };
  const active = useBrandStore((s) => s.active);
  const brandId = active && /^[0-9a-f-]{36}$/i.test(active.id) ? active.id : undefined;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["conversations", brandId],
    queryFn: () => fetchThreads(brandId!),
    enabled: Boolean(brandId),
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Conversations</h2>
        </div>
        <NewThreadButtons brandId={brandId} />
      </div>

      {data && brandId && <TextEditorBanner info={data} brandId={brandId} className="mt-4" />}

      {data && data.threads.length > 0 && (
        <div role="tablist" aria-label="Show conversations" className="mt-6 inline-flex rounded-lg border p-0.5">
          {FILTERS.map((f) => {
            const count = f.value === "all" ? data.threads.length : data.threads.filter((t) => t.startedVia === f.value).length;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => choose(f.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  filter === f.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label} <span className="opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {!brandId && <EmptyState icon={MessagesSquare} title="No brand selected" description="Pick a brand in the sidebar to see its conversations." />}
        {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        {isError && <p className="text-sm text-destructive">Could not load conversations.</p>}
        {data && data.threads.length === 0 && (
          <EmptyState icon={MessagesSquare} title="No conversations yet" description="Start a new reel or story to talk to the editor." />
        )}
        {data && data.threads.length > 0 && shown(data.threads, filter).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No conversations {filter === "sms" ? "started by text" : "started in the app"} yet.
          </p>
        )}
        {data && shown(data.threads, filter).map((t) => <ThreadItem key={t.id} thread={t} />)}
      </div>
    </>
  );
}

const shown = (threads: ThreadRow[], filter: Filter) => (filter === "all" ? threads : threads.filter((t) => t.startedVia === filter));

function ThreadItem({ thread: t }: { thread: ThreadRow }) {
  const last = t.lastMessage;
  return (
    <Link href={`/conversations/${t.id}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <Card className="py-0 transition-colors hover:bg-accent/40">
        <CardContent className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{kindLabel(t.kind)}</span>
              <StartedVia channel={t.startedVia} />
              {t.status === "open" ? <Badge>Open</Badge> : <Badge variant="outline">Closed</Badge>}
              {!t.brandId && <Badge variant="secondary">Brand not chosen</Badge>}
              {!t.mine && <Badge variant="secondary">Teammate</Badge>}
            </div>
            {last ? (
              <p className="truncate text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{last.direction === "in" ? (t.mine ? "You" : "Teammate") : "Editor"}:</span> {last.body}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
            <span>{formatDistanceToNow(new Date(last?.createdAt ?? t.createdAt), { addSuffix: true })}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
