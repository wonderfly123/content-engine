"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { addDays, endOfDay, format, startOfDay } from "date-fns";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Channel, ContentFormat, PostStatus } from "@/lib/db/enums";

interface PostListItem {
  id: string;
  draftId: string;
  channel: Channel;
  format: ContentFormat;
  status: PostStatus;
  scheduledFor: string;
}

async function fetchPosts(
  brandId: string,
  from: Date,
  to: Date,
): Promise<PostListItem[]> {
  const params = new URLSearchParams({
    brandId,
    from: from.toISOString(),
    to: to.toISOString(),
    status: "queued,publishing,published,failed",
  });
  const res = await fetch(`/api/posts?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    data: { posts: PostListItem[] } | null;
  };
  return json.data?.posts ?? [];
}

const statusVariant: Record<
  PostStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  publishing: "secondary",
  published: "secondary",
  failed: "destructive",
};

function PostRow({
  post,
  timeFormat,
}: {
  post: PostListItem;
  timeFormat: string;
}) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
        {format(new Date(post.scheduledFor), timeFormat)}
      </span>
      <span className="capitalize">{post.channel}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
        {post.format}
      </span>
      <Badge
        variant={statusVariant[post.status]}
        className="ml-auto capitalize"
      >
        {post.status}
      </Badge>
    </li>
  );
}

function QueueCardBody({
  isLoading,
  isError,
  posts,
  emptyLabel,
  timeFormat,
  maxItems,
}: {
  isLoading: boolean;
  isError: boolean;
  posts: PostListItem[] | undefined;
  emptyLabel: string;
  timeFormat: string;
  maxItems: number;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    );
  }
  if (isError || !posts) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load scheduled posts.
      </p>
    );
  }
  if (posts.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const visible = posts.slice(0, maxItems);
  const remaining = posts.length - visible.length;
  return (
    <>
      <ul className="divide-y" role="list">
        {visible.map((p) => (
          <PostRow key={p.id} post={p} timeFormat={timeFormat} />
        ))}
      </ul>
      {remaining > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          +{remaining} more on the calendar.
        </p>
      )}
    </>
  );
}

export function TodayQueueCard({ brandId }: { brandId: string }) {
  const range = useMemo(() => {
    const now = new Date();
    return { from: startOfDay(now), to: endOfDay(now) };
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "dashboard-posts",
      brandId,
      "today",
      range.from.toISOString(),
    ],
    queryFn: () => fetchPosts(brandId, range.from, range.to),
    retry: 1,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Today&apos;s queue</CardTitle>
        <CardDescription>Posts scheduled to publish today</CardDescription>
        <CardAction>
          <Link
            href="/calendar?view=week"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Open calendar
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <QueueCardBody
          isLoading={isLoading}
          isError={isError}
          posts={data}
          emptyLabel="No posts scheduled today."
          timeFormat="h:mm a"
          maxItems={5}
        />
      </CardContent>
    </Card>
  );
}

export function WeekQueueCard({ brandId }: { brandId: string }) {
  const range = useMemo(() => {
    const now = new Date();
    return { from: startOfDay(now), to: endOfDay(addDays(now, 6)) };
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "dashboard-posts",
      brandId,
      "week",
      range.from.toISOString(),
    ],
    queryFn: () => fetchPosts(brandId, range.from, range.to),
    retry: 1,
  });

  const count = data?.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">This week</CardTitle>
        <CardDescription>
          {data
            ? `${count} post${count === 1 ? "" : "s"} in the next 7 days`
            : "Posts in the next 7 days"}
        </CardDescription>
        <CardAction>
          <Link
            href="/calendar"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Open calendar
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <QueueCardBody
          isLoading={isLoading}
          isError={isError}
          posts={data}
          emptyLabel="Nothing scheduled this week."
          timeFormat="EEE h:mm a"
          maxItems={5}
        />
      </CardContent>
    </Card>
  );
}
