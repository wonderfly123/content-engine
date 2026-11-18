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
import { formatBytes, isClipsMessage } from "@/lib/media/rules";
import { useBrandStore } from "@/lib/stores/brand-store";
import { cn } from "@/lib/utils";
import type { Clip } from "./clip-list";
import { UploadProgress } from "./clip-uploader";
import { EditingBubble, EditorAvatar, EditorCuts, type EditorJobView } from "./editor-cuts";
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

/** Clips shown on the "Added N clips" message they came with; any not yet reported come back as `rest`. */
function attachClips(messages: Message[], clips: Clip[]): { byMessage: Map<string, Clip[]>; rest: Clip[] } {
  const sorted = [...clips].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const byMessage = new Map<string, Clip[]>();
  let i = 0;
  for (const m of messages) {
    if (!isClipsMessage(m.body)) continue;
    const t = Date.parse(m.createdAt);
    const batch: Clip[] = [];
    while (i < sorted.length && Date.parse(sorted[i].createdAt) <= t) batch.push(sorted[i++]);
    if (batch.length) byMessage.set(m.id, batch);
  }
  return { byMessage, rest: sorted.slice(i) };
}

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

  // Full page: fill the space under the top bar edge to edge (cancelling the layout's 1.5rem padding).
  const height = compact ? "h-[calc(100dvh-7.5rem)]" : "-m-6 h-[calc(100%+3rem)]";
  if (isLoading) return <Skeleton className={cn("w-full rounded-xl", compact ? height : "h-[calc(100dvh-7rem)]")} />;
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
  const { byMessage, rest } = attachClips(data.messages, data.clips ?? []);
  const column = cn("mx-auto w-full max-w-3xl", compact ? "px-3" : "px-4 sm:px-6");

  return (
    <div
      className={cn("relative flex flex-col bg-background", height)}
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
      {/* Header: a slim bar, like a chat app's */}
      <div className={cn("flex shrink-0 items-center justify-between gap-2 border-b py-2", compact ? "px-3" : "px-4 sm:px-6")}>
        <div className="flex min-w-0 items-center gap-2">
          {!compact && (
            <Link href="/conversations" aria-label="Back to conversations" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          <h2 className="truncate text-sm font-medium">
            {c.title ?? kindLabel(c.kind)}
            <span className="font-normal text-muted-foreground">
              {c.title ? ` · ${kindLabel(c.kind)}` : ""}
              {c.brand ? ` · ${c.brand.name}` : ""}
            </span>
          </h2>
          {closed && <Badge variant="outline">Closed</Badge>}
        </div>
        {compact ? (
          <Link href={`/conversations/${id}`} className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Open full page
          </Link>
        ) : (
          <NewThreadButtons brandId={c.brand?.id ?? active?.id} />
        )}
      </div>

      {/* Messages */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        <div className={cn(column, "space-y-6 py-6")}>
          <p className="text-center text-xs text-muted-foreground">
            Started {format(new Date(c.createdAt), "MMM d, h:mm a")}
            {c.startedVia === "sms" ? " by text" : ""}
          </p>
          {data.messages.map((m) => (
            <Turn key={m.id} message={m} clips={byMessage.get(m.id)} mine={c.mine} compact={compact} onApprove={approve} approving={approving} />
          ))}
          {rest.length > 0 && (
            <div className="flex justify-end">
              <ClipChips clips={rest} />
            </div>
          )}
          {running && <EditingBubble />}
          {/* After approval: when it posts (the same step as the watch page and texts) */}
          {!closed && <SchedulePanel conversationId={id} onChange={() => void qc.invalidateQueries({ queryKey: ["conversation", id] })} />}
          {data.messages.length === 0 && <p className="text-center text-sm text-muted-foreground">No messages yet.</p>}
        </div>
      </div>

      {/* Composer, pinned to the bottom */}
      <div className={cn(column, "shrink-0 space-y-2 pb-3 pt-1")}>
        <UploadProgress up={up} />
        {closed ? (
          <div className="rounded-3xl border bg-muted/30 px-5 py-4 text-sm text-muted-foreground">
            {CLOSED_BECAUSE[c.closedReason ?? ""] ?? "This conversation is closed."} Start a new reel or story to keep going.
          </div>
        ) : (
          <>
            <div className="flex items-end gap-1 rounded-3xl border bg-background p-2 shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-within:border-foreground/20">
              <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full text-muted-foreground" onClick={() => picker.current?.click()} aria-label="Add clips">
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
                className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-base outline-none placeholder:text-muted-foreground"
              />
              <Button type="button" size="icon" className="shrink-0 rounded-full" onClick={() => void send()} disabled={sending || !draft.trim()} aria-label="Send">
                <ArrowUp aria-hidden="true" />
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">Add clips with the paperclip or drop them here. Ask for changes, or reply &ldquo;yes&rdquo; to approve.</p>
          </>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary bg-background/80 text-sm font-medium">
          <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
          Drop clips to add them
        </div>
      )}
    </div>
  );
}

/** Attached clips, like files on a chat message: tap one to play it. */
function ClipChips({ clips }: { clips: Clip[] }) {
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-1.5" aria-label="Clips">
      {clips.map((clip) => {
        const label = CLIP_STATUS[clip.status];
        const playable = clip.status === "ready" || clip.status === "processing";
        const was = clip.originalSizeBytes && clip.originalSizeBytes > clip.sizeBytes ? `, was ${formatBytes(clip.originalSizeBytes)}` : "";
        const inner = (
          <>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Film className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col text-left leading-tight">
              <span className="max-w-[9rem] truncate text-xs font-medium">{clip.filename}</span>
              <span className={cn("text-[11px]", clip.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {formatBytes(clip.sizeBytes)}
                {label && ` · ${label}`}
              </span>
            </span>
          </>
        );
        const cls = "flex items-center gap-2 rounded-xl border bg-background p-1.5 pr-3";
        return playable ? (
          <a key={clip.id} href={`/api/media/${clip.id}`} target="_blank" rel="noopener noreferrer" className={cn(cls, "hover:bg-muted/50")} title={`${clip.filename} (${formatBytes(clip.sizeBytes)}${was})`}>
            {inner}
          </a>
        ) : (
          <span key={clip.id} className={cls} title={clip.filename}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

function Meta({ m, teammate }: { m: Message; teammate: boolean }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground transition-opacity md:opacity-0 md:group-hover:opacity-100">
      {teammate && "Teammate · "}
      {m.channel === "sms" && (
        <>
          <MessageSquare className="h-3 w-3" aria-hidden="true" />
          Text ·
        </>
      )}
      <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
    </span>
  );
}

/** One turn: yours as a grey bubble on the right (with its clips), the editor's as plain text on the left. */
function Turn({
  message: m,
  clips,
  mine,
  compact,
  onApprove,
  approving,
}: {
  message: Message;
  clips?: Clip[];
  mine: boolean;
  compact: boolean;
  onApprove: () => void;
  approving: boolean;
}) {
  // A clips upload is always the person's, even on older threads that stored it as the editor's.
  if (m.direction === "in" || isClipsMessage(m.body)) {
    return (
      <div className="group flex flex-col items-end gap-1.5">
        {clips && <ClipChips clips={clips} />}
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed">{m.body}</div>
        <Meta m={m} teammate={!mine} />
      </div>
    );
  }
  return (
    <div className="group flex gap-3">
      <EditorAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="whitespace-pre-wrap break-words pt-0.5 text-[15px] leading-relaxed">{m.body}</div>
        {m.editor && <EditorCuts job={m.editor} compact={compact} onApprove={onApprove} approving={approving} />}
        <Meta m={m} teammate={false} />
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
