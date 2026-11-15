"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clapperboard, Film, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { kindLabel, type Kind } from "@/components/conversations/shared";
import { ThreadView } from "@/components/conversations/thread-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface OpenThread {
  id: string;
  kind: Kind;
  status: "open" | "closed";
  mine: boolean;
  lastMessage: { body: string } | null;
}

async function fetchThreads(brandId: string): Promise<OpenThread[]> {
  const res = await fetch(`/api/conversations?${new URLSearchParams({ brandId })}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { threads: OpenThread[] }).threads ?? [];
}

const TILES = [
  { kind: "reel" as const, icon: Clapperboard, title: "New reel", body: "A 15 to 60 second vertical video for your feed." },
  { kind: "story" as const, icon: Film, title: "New story", body: "A quick vertical video for your story." },
];

/**
 * The "start here" card at the top of the dashboard: start a reel or story, or pick up the one in
 * progress. Opens the same conversation a text would, in a side panel.
 */
export function StartVideo({ brandId }: { brandId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reel" | "story" | null>(null);
  const { data: threads, refetch } = useQuery({ queryKey: ["conversations", brandId], queryFn: () => fetchThreads(brandId) });
  const current = threads?.find((t) => t.status === "open" && t.mine);

  const start = async (kind: "reel" | "story") => {
    setBusy(kind);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, kind }),
      });
      const json = (await res.json().catch(() => ({}))) as { conversationId?: string; error?: string };
      if (!res.ok || !json.conversationId) throw new Error(json.error ?? `HTTP ${res.status}`);
      setOpenId(json.conversationId);
      void refetch();
    } catch (e) {
      toast.error(`Could not start: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card className="overflow-hidden border-orange-200/70 bg-gradient-to-br from-amber-50 to-orange-50 dark:border-orange-900/50 dark:from-amber-950/30 dark:to-orange-950/20">
        <CardContent className="space-y-5 p-6">
          <div>
            <h3 className="text-xl font-semibold tracking-tight">Make a video</h3>
            <p className="mt-1 text-sm text-muted-foreground">Upload your clips, the editor cuts them, you approve. You can also text &ldquo;new reel&rdquo; once texting is on.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {TILES.map(({ kind, icon: Icon, title, body }) => (
              <button
                key={kind}
                type="button"
                onClick={() => void start(kind)}
                disabled={busy !== null}
                className="group flex items-start gap-4 rounded-xl border bg-background p-4 text-left shadow-sm transition-all hover:border-orange-300 hover:shadow-md disabled:opacity-60"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-semibold">
                    {busy === kind ? "Starting..." : title}
                    <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{body}</span>
                </span>
              </button>
            ))}
          </div>

          {current && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-background/70 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Pick up where you left off: {kindLabel(current.kind)}</p>
                {current.lastMessage && <p className="truncate text-sm text-muted-foreground">{current.lastMessage.body}</p>}
              </div>
              <Button variant="outline" size="sm" onClick={() => setOpenId(current.id)}>
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Continue
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={openId !== null} onOpenChange={(open) => { if (!open) { setOpenId(null); void refetch(); } }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Talk to the editor</SheetTitle>
            <SheetDescription>Same conversation as texting. It is saved under Conversations.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">{openId && <ThreadView id={openId} compact onSwitch={setOpenId} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
