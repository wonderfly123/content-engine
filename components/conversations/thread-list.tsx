"use client";

import { TextEditorBanner, type TextingInfo } from "@/components/conversations/text-editor-banner";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Monitor, Smartphone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrandStore } from "@/lib/stores/brand-store";
import { cn } from "@/lib/utils";
import { ConversationListToggle } from "./conversations-shell";
import { kindLabel, NewThreadButtons, type Channel, type Kind } from "./shared";

interface ThreadRow {
  id: string;
  kind: Kind;
  title: string | null;
  status: "open" | "closed";
  startedVia: Channel;
  brandId: string | null;
  mine: boolean;
  createdAt: string;
  closedReason: string | null;
  lastMessage: { body: string; direction: "in" | "out"; channel: Channel; createdAt: string } | null;
}

export async function fetchThreads(brandId: string): Promise<{ threads: ThreadRow[] } & TextingInfo> {
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

/** The active brand's id, when one is chosen. */
export function useActiveBrandId(): string | undefined {
  const active = useBrandStore((s) => s.active);
  return active && /^[0-9a-f-]{36}$/i.test(active.id) ? active.id : undefined;
}

/** The brand's threads plus texting info; one cache shared by the sidebar and the empty page. */
export function useThreads(brandId: string | undefined) {
  return useQuery({
    queryKey: ["conversations", brandId],
    queryFn: () => fetchThreads(brandId!),
    enabled: Boolean(brandId),
    refetchInterval: 15_000,
  });
}

/**
 * The conversations column, like ChatGPT's: New reel / New story at the top, the brand's threads
 * newest first (filterable by where they started), the open one highlighted.
 */
export function ConversationSidebar({ className }: { className?: string }) {
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
  const brandId = useActiveBrandId();
  const pathname = usePathname();
  const activeId = pathname.split("/")[2];
  const { data, isLoading, isError, refetch } = useThreads(brandId);
  // A thread just started (or a reply moved to a new one): show it straight away.
  useEffect(() => {
    if (brandId) void refetch();
  }, [pathname, brandId, refetch]);

  const rows = data ? shown(data.threads, filter) : [];
  return (
    <aside className={cn("h-full w-full shrink-0 flex-col border-r bg-muted/30 md:w-72", className)} aria-label="Chats">
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <NewThreadButtons brandId={brandId} />
          <ConversationListToggle />
        </div>
        {data && data.threads.length > 0 && (
          <div role="tablist" aria-label="Filter chats" className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => choose(f.value)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs transition-colors",
                  filter === f.value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {!brandId && <p className="px-3 py-2 text-sm text-muted-foreground">Pick a brand to see its chats.</p>}
        {isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        {isError && <p className="px-3 py-2 text-sm text-destructive">Could not load chats.</p>}
        {data && data.threads.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No chats yet.</p>}
        {data && data.threads.length > 0 && rows.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">None {filter === "sms" ? "started by text" : "started in the app"} yet.</p>
        )}
        {rows.map((t) => (
          <ThreadRowLink key={t.id} thread={t} active={t.id === activeId} />
        ))}
      </nav>

      {data && brandId && <TextEditorBanner info={data} brandId={brandId} className="m-3 p-3" />}
    </aside>
  );
}

const shown = (threads: ThreadRow[], filter: Filter) => (filter === "all" ? threads : threads.filter((t) => t.startedVia === filter));

function ThreadRowLink({ thread: t, active }: { thread: ThreadRow; active: boolean }) {
  const last = t.lastMessage;
  const closed = t.status === "closed";
  return (
    <Link
      href={`/conversations/${t.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-lg px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      <div className="flex items-center gap-1.5">
        {t.startedVia === "sms" && <Smartphone className="h-3 w-3 shrink-0 text-sky-600 dark:text-sky-400" aria-label="Started by text" />}
        <span className={cn("truncate text-sm", closed ? "text-muted-foreground" : "font-medium")}>{t.title ?? kindLabel(t.kind)}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatDistanceToNowStrict(new Date(last?.createdAt ?? t.createdAt))}</span>
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {!t.mine && "Teammate · "}
        {last ? last.body : "No messages yet"}
      </p>
    </Link>
  );
}
