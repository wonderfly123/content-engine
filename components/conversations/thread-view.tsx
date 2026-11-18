"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday } from "date-fns";
import { ArrowLeft, ArrowUp, Film, MessageSquare, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/media/rules";
import { useBrandStore } from "@/lib/stores/brand-store";
import { cn } from "@/lib/utils";
import type { Clip } from "./clip-list";
import { UploadProgress } from "./clip-uploader";
import { EditingBubble, EditorCuts, type EditorJobView } from "./editor-cuts";
import { SchedulePanel } from "./schedule-panel";
import { kindLabel, NewThreadButtons, type Channel, type Kind } from "./shared";
import { useClipUploads } from "./use-clip-uploads";

interface Message {
  id: string;
  direction: "in" | "out";
  channel: Channel;
  body: string;
  createdAt: string;
  /** An editor reply's cuts. */
  editor?: EditorJobView | null;
}

interface ThreadData {
  conversation: {
    id: string;
    kind: Kind;
    title: string | null;
    description: string | null;
    status: "open" | "closed";
    startedVia: Channel;
    closedReason: string | null;
    createdAt: string;
    mine: boolean;
    brand: { id: string; name: string } | null;
  };
  messages: Message[];
  clips?: Clip[];
  /** Whether the editor is working on a job for this thread. */
  editor?: { running: boolean };
}

const CLOSED_BECAUSE: Record<string, string> = {
  published: "This conversation closed when the post was published.",
  new_thread: "This conversation closed when a new reel or story was started.",
};

const CLIP_STATUS: Record<Clip["status"], string> = { ready: "", processing: "Optimizing", uploading: "Not finished", failed: "Failed" };

async function fetchThread(id: string): Promise<ThreadData> {
  const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
  if (res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const when = (iso: string) => {
  const d = new Date(iso);
  return isToday(d) ? format(d, "h:mm a") : format(d, "MMM d, h:mm a");
};

/**
 * One conversation with the editor, laid out like a chat: messages fill the space and scroll, the
 * composer sits at the bottom with a paperclip for clips, and files can be dropped anywhere on it.
 * Used as a full page and, with `compact`, inside the dashboard side panel.
 */
export function ThreadView({
  id,
  compact = false,
  onSwitch,
}: {
  id: string;
  /** Panel mode: no back link or New buttons, and a link to the full page. */
  compact?: boolean;
  /** Called when the conversation moves to a new thread (someone typed "new reel"); defaults to opening its page. */
  onSwitch?: (conversationId: string) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const active = useBrandStore((s) => s.active);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [approving, setApproving] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => fetchThread(id),
    // Poll quickly only while the editor is working.
    refetchInterval: (q) => (q.state.data?.editor?.running ? 5_000 : 15_000),
  });
  const up = useClipUploads(id, () => void qc.invalidateQueries({ queryKey: ["conversation", id] }));

  // Keep the newest message in view.
  const count = data?.messages.length ?? 0;
  const running = Boolean(data?.editor?.running);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [count, up.items.length, running]);

  // Grow the composer with its text, up to a few lines.
  useEffect(() => {
    const el = composer.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
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
      if (json.conversationId && json.conversationId !== id) {
        if (onSwitch) onSwitch(json.conversationId);
        else router.push(`/conversations/${json.conversationId}`);
      } else await qc.invalidateQueries({ queryKey: ["conversation", id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const approve = async () => {
    if (approving) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/conversations/${id}/approve`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      await qc.invalidateQueries({ queryKey: ["conversation", id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApproving(false);
    }
  };

  const height = compact ? "h-[calc(100dvh-7.5rem)]" : "h-[calc(100dvh-7rem)]";
  if (isLoading) return <Skeleton className={cn("w-full rounded-xl", height)} />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        {!compact && <BackLink />}
        <p className="text-sm text-muted-foreground">{(error as Error)?.message === "not_found" ? "This conversation doesn't exist or isn't yours." : "Could not load this conversation."}</p>
      </div>
    );
  }

  const c = data.conversation;
  const closed = c.status === "closed";
  const clips = data.clips ?? [];

  return (
    <div
      className={cn("relative mx-auto flex w-full max-w-3xl flex-col gap-3", height)}
      onDragOver={(e) => {
        if (closed || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (closed) return;
        e.preventDefault();
        setDragging(false);
        up.addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {!compact && (
            <Link href="/conversations" aria-label="Back to conversations" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          <h2 className={cn("truncate font-semibold tracking-tight", compact ? "text-base" : "text-lg")}>
            {c.title ?? kindLabel(c.kind)}
            <span className="font-normal text-muted-foreground">
              {c.title ? ` · ${kindLabel(c.kind)}` : ""}
              {c.brand ? ` · ${c.brand.name}` : ""}
            </span>
          </h2>
          {closed ? <Badge variant="outline">Closed</Badge> : <Badge>Open</Badge>}
        </div>
        {compact ? (
          <Link href={`/conversations/${id}`} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Open full page
          </Link>
        ) : (
          <NewThreadButtons brandId={c.brand?.id ?? active?.id} />
        )}
      </div>

      {/* Messages */}
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-2xl border bg-muted/20 p-4" aria-live="polite">
        <p className="text-center text-xs text-muted-foreground">Started {format(new Date(c.createdAt), "MMM d, h:mm a")}{c.startedVia === "sms" ? " by text" : ""}</p>
        {data.messages.map((m) => (
          <Bubble key={m.id} message={m} mine={c.mine} compact={compact} onApprove={approve} approving={approving} />
        ))}
        {running && <EditingBubble />}
        {data.messages.length === 0 && <p className="text-center text-sm text-muted-foreground">No messages yet.</p>}
      </div>

      {/* Clips in this conversation */}
      {clips.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1" aria-label="Clips">
          {clips.map((clip) => {
            const label = CLIP_STATUS[clip.status];
            const playable = clip.status === "ready" || clip.status === "processing";
            const was = clip.originalSizeBytes && clip.originalSizeBytes > clip.sizeBytes ? `, was ${formatBytes(clip.originalSizeBytes)}` : "";
            const inner = (
              <>
                <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="max-w-[10rem] truncate">{clip.filename}</span>
                <span className="text-muted-foreground">{formatBytes(clip.sizeBytes)}</span>
                {label && <span className={cn(clip.status === "failed" ? "text-destructive" : "text-muted-foreground")}>· {label}</span>}
              </>
            );
            const cls = "flex shrink-0 items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs";
            return playable ? (
              <a key={clip.id} href={`/api/media/${clip.id}`} target="_blank" rel="noopener noreferrer" className={cn(cls, "hover:bg-muted")} title={`${clip.filename} (${formatBytes(clip.sizeBytes)}${was})`}>
                {inner}
              </a>
            ) : (
              <span key={clip.id} className={cls} title={clip.filename}>
                {inner}
              </span>
            );
          })}
        </div>
      )}

      {/* After approval: when it posts (the same step as the watch page and texts) */}
      {!closed && <SchedulePanel conversationId={id} onChange={() => void qc.invalidateQueries({ queryKey: ["conversation", id] })} />}

      {/* Uploads in progress */}
      <UploadProgress up={up} />

      {/* Composer */}
      {closed ? (
        <div className="shrink-0 rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
          {CLOSED_BECAUSE[c.closedReason ?? ""] ?? "This conversation is closed."} Start a new reel or story to keep going.
        </div>
      ) : (
        <div className="shrink-0">
          <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
            <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={() => picker.current?.click()} aria-label="Add clips">
              <Paperclip aria-hidden="true" />
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              accept="video/*,.mov,.mp4,.m4v"
              className="hidden"
              onChange={(e) => {
                up.addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <label htmlFor={`composer-${id}`} className="sr-only">
              Message the editor
            </label>
            <textarea
              id={`composer-${id}`}
              ref={composer}
              rows={1}
              placeholder="Message the editor…"
              value={draft}
              maxLength={1600}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={sending}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button type="button" size="icon" className="shrink-0 rounded-full" onClick={() => void send()} disabled={sending || !draft.trim()} aria-label="Send">
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
          <p className="mt-1.5 px-2 text-xs text-muted-foreground">
            Add clips with the paperclip or drop them here. Ask for changes, or reply &ldquo;yes&rdquo; to approve.
          </p>
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/80 text-sm font-medium">
          <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
          Drop clips to add them
        </div>
      )}
    </div>
  );
}

function Bubble({
  message: m,
  mine,
  compact,
  onApprove,
  approving,
}: {
  message: Message;
  mine: boolean;
  compact: boolean;
  onApprove: () => void;
  approving: boolean;
}) {
  const fromPerson = m.direction === "in";
  const hasCuts = Boolean(m.editor && m.editor.cuts.length > 0);
  return (
    <div className={cn("flex items-end gap-2", fromPerson ? "justify-end" : "justify-start")}>
      {!fromPerson && (
        <span className="mb-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-xs font-bold text-white" aria-hidden="true">
          N
        </span>
      )}
      <div className={cn("flex flex-col gap-1", hasCuts ? "w-full max-w-[min(100%,36rem)]" : "max-w-[78%]", fromPerson ? "items-end" : "items-start")}>
        <div
          className={cn(
            "whitespace-pre-wrap break-words px-3.5 py-2 text-sm leading-relaxed",
            fromPerson ? "rounded-2xl rounded-br-md bg-primary text-primary-foreground" : "rounded-2xl rounded-bl-md border bg-background",
          )}
        >
          {m.body}
        </div>
        {m.editor && <EditorCuts job={m.editor} compact={compact} onApprove={onApprove} approving={approving} />}
        <span className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
          {fromPerson && !mine && "Teammate · "}
          {m.channel === "sms" && (
            <>
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              Text ·
            </>
          )}
          <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
        </span>
      </div>
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
