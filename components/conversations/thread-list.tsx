"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrandStore } from "@/lib/stores/brand-store";
import { ChannelMarker, kindLabel, NewThreadButtons, type Channel, type Kind } from "./shared";

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

async function fetchThreads(brandId: string): Promise<{ threads: ThreadRow[]; textingEnabled: boolean }> {
  const res = await fetch(`/api/conversations?${new URLSearchParams({ brandId })}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The active brand's conversations with the editor, newest first. */
export function ThreadList() {
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
          <p className="text-sm text-muted-foreground">
            One thread per video with the editor, by text or here. Pick up a thread in either place.
          </p>
        </div>
        <NewThreadButtons brandId={brandId} />
      </div>

      {data && !data.textingEnabled && (
        <p className="mt-4 rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
          Texting isn&apos;t switched on yet. Conversations work here in the app in the meantime.
        </p>
      )}
      {data?.textingEnabled && (
        <p className="mt-4 text-sm text-muted-foreground">
          To text the editor, add and confirm your number in{" "}
          <Link href="/settings" className="underline underline-offset-4">
            Settings
          </Link>
          , then text &quot;new reel&quot; or &quot;new story&quot;.
        </p>
      )}

      <div className="mt-6 space-y-2">
        {!brandId && <EmptyState icon={MessagesSquare} title="No brand selected" description="Pick a brand in the sidebar to see its conversations." />}
        {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        {isError && <p className="text-sm text-destructive">Could not load conversations.</p>}
        {data && data.threads.length === 0 && (
          <EmptyState icon={MessagesSquare} title="No conversations yet" description="Start a new reel or story to talk to the editor." />
        )}
        {data?.threads.map((t) => <ThreadItem key={t.id} thread={t} />)}
      </div>
    </>
  );
}

function ThreadItem({ thread: t }: { thread: ThreadRow }) {
  const last = t.lastMessage;
  return (
    <Link href={`/conversations/${t.id}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <Card className="py-0 transition-colors hover:bg-accent/40">
        <CardContent className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{kindLabel(t.kind)}</span>
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
            <span className="inline-flex items-center gap-1">
              Started in <ChannelMarker channel={t.startedVia} />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
