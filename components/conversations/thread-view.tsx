"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useBrandStore } from "@/lib/stores/brand-store";
import { cn } from "@/lib/utils";
import { ChannelMarker, kindLabel, NewThreadButtons, type Channel, type Kind } from "./shared";

interface ThreadData {
  conversation: {
    id: string;
    kind: Kind;
    status: "open" | "closed";
    startedVia: Channel;
    closedReason: string | null;
    createdAt: string;
    mine: boolean;
    brand: { id: string; name: string } | null;
  };
  messages: Array<{ id: string; direction: "in" | "out"; channel: Channel; body: string; createdAt: string }>;
}

const CLOSED_BECAUSE: Record<string, string> = {
  published: "Closed: the post was published.",
  new_thread: "Closed: a new reel or story was started.",
};

async function fetchThread(id: string): Promise<ThreadData> {
  const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
  if (res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** One conversation: every message with where it came from, and a composer for app messages. */
export function ThreadView({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const active = useBrandStore((s) => s.active);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ["conversation", id], queryFn: () => fetchThread(id), refetchInterval: 15_000 });

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = (await res.json().catch(() => ({}))) as { conversationId?: string | null; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDraft("");
      qc.invalidateQueries({ queryKey: ["conversations"] });
      // "new reel" typed here opens a new thread: follow it.
      if (json.conversationId && json.conversationId !== id) router.push(`/conversations/${json.conversationId}`);
      else await qc.invalidateQueries({ queryKey: ["conversation", id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">{(error as Error)?.message === "not_found" ? "This conversation doesn't exist or isn't yours." : "Could not load this conversation."}</p>
      </div>
    );
  }

  const c = data.conversation;
  const closed = c.status === "closed";
  return (
    <div className="space-y-4">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {kindLabel(c.kind)}
            {c.brand && <span className="text-muted-foreground">for {c.brand.name}</span>}
            {closed ? <Badge variant="outline">Closed</Badge> : <Badge>Open</Badge>}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Started {format(new Date(c.createdAt), "MMM d, h:mm a")} in <ChannelMarker channel={c.startedVia} />
            {!c.brand && " · Brand not chosen yet"}
          </p>
        </div>
        <NewThreadButtons brandId={c.brand?.id ?? active?.id} />
      </div>

      <Card>
        <CardContent className="space-y-3">
          {data.messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
          {data.messages.map((m) => (
            <div key={m.id} className={cn("flex flex-col gap-1", m.direction === "in" ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                  m.direction === "in" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {m.body}
              </div>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {m.direction === "in" ? (c.mine ? "You" : "Teammate") : "Editor"}
                <ChannelMarker channel={m.channel} />
                <time dateTime={m.createdAt}>{format(new Date(m.createdAt), "MMM d, h:mm a")}</time>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
        <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
        Uploading clips here is coming soon.
      </div>

      {closed ? (
        <p className="text-sm text-muted-foreground">
          {CLOSED_BECAUSE[c.closedReason ?? ""] ?? "This conversation is closed."} Start a new reel or story to keep going.
        </p>
      ) : (
        <div className="space-y-2">
          <label htmlFor="composer" className="sr-only">
            Message the editor
          </label>
          <Textarea
            id="composer"
            placeholder='Ask for a change, answer a question, or type "yes" to approve.'
            value={draft}
            maxLength={1600}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
            disabled={sending}
          />
          <div className="flex justify-end">
            <Button onClick={() => void send()} disabled={sending || !draft.trim()}>
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/conversations" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      Conversations
    </Link>
  );
}
