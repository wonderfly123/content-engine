"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Film } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Kind = "reel" | "story" | null;
export type Channel = "sms" | "app";

export const kindLabel = (kind: Kind) => (kind === "reel" ? "Reel" : kind === "story" ? "Story" : "Reel or story?");

/** "Text" or "App", with an icon: where a message was written or sent. */
export function ChannelMarker({ channel, className }: { channel: Channel; className?: string }) {
  const Icon = channel === "sms" ? Smartphone : Monitor;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {channel === "sms" ? "Text" : "App"}
    </span>
  );
}

/** New reel / New story: closes your open thread and opens a new one for this brand. */
export function NewThreadButtons({
  brandId,
  size = "sm",
  onStarted,
}: {
  brandId: string | undefined;
  size?: "sm" | "default";
  /** Called with the new thread instead of opening its page (the dashboard opens it in a panel). */
  onStarted?: (conversationId: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"reel" | "story" | null>(null);

  const start = async (kind: "reel" | "story") => {
    if (!brandId) return;
    setBusy(kind);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, kind }),
      });
      const json = (await res.json().catch(() => ({}))) as { conversationId?: string; error?: string };
      if (!res.ok || !json.conversationId) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (onStarted) {
        onStarted(json.conversationId);
        setBusy(null);
      } else router.push(`/conversations/${json.conversationId}`);
      // The chats column stays on screen now, so the button must come back from "Starting...".
      setBusy(null);
    } catch (e) {
      toast.error(`Could not start: ${(e as Error).message}`);
      setBusy(null);
    }
  };

  return (
    <div className="flex gap-2">
      <Button size={size} onClick={() => start("reel")} disabled={!brandId || busy !== null}>
        <Clapperboard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {busy === "reel" ? "Starting..." : "New reel"}
      </Button>
      <Button size={size} variant="outline" onClick={() => start("story")} disabled={!brandId || busy !== null}>
        <Film className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {busy === "story" ? "Starting..." : "New story"}
      </Button>
    </div>
  );
}
