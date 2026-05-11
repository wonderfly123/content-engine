"use client";

import Link from "next/link";
import { Circle, CircleDashed, CircleDot } from "lucide-react";
import type { Channel, ContentFormat, PostStatus } from "@/lib/db/enums";
import { cn } from "@/lib/utils";

export interface CalendarPost {
  id: string;
  draftId: string;
  channel: Channel;
  format: ContentFormat;
  status: PostStatus;
  scheduledFor: string;
  publishedAt?: string | null;
  externalUrl?: string | null;
  caption?: string;
}

const channelColor: Partial<Record<Channel, string>> = {
  instagram: "#E1306C",
  facebook: "#1877F2",
};

function StatusIcon({ status }: { status: PostStatus }) {
  if (status === "published") return <Circle className="h-3 w-3 fill-current" />;
  if (status === "queued") return <CircleDashed className="h-3 w-3" />;
  return <CircleDot className="h-3 w-3" />;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PostTile({
  post,
  draggable = false,
  onDragStart,
  compact = false,
}: {
  post: CalendarPost;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, postId: string) => void;
  compact?: boolean;
}) {
  const band = channelColor[post.channel] ?? "#9CA3AF";
  const isPublished = post.status === "published";
  const href = isPublished
    ? `/analytics/post/${post.id}`
    : `/drafts/${post.draftId}`;

  return (
    <Link
      href={href}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, post.id)}
      className={cn(
        "group relative flex w-full items-center gap-1 overflow-hidden rounded-sm border bg-card px-1.5 py-1 text-[10px] hover:bg-accent",
        draggable && "cursor-grab active:cursor-grabbing",
        compact && "px-1 py-0.5",
      )}
      data-status={post.status}
      data-post-id={post.id}
      title={post.caption ?? ""}
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ backgroundColor: band }}
      />
      <span className="ml-1 inline-flex items-center text-muted-foreground">
        <StatusIcon status={post.status} />
      </span>
      <span className="rounded bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wide">
        {post.format}
      </span>
      <span className="ml-auto tabular-nums text-muted-foreground">
        {timeLabel(post.scheduledFor)}
      </span>
    </Link>
  );
}
