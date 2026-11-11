"use client";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Summary for one channel over the selected window (see /api/analytics/topline). */
export interface ToplineMetrics {
  followers: { total: number | null; change: number | null };
  views: number;
  reach: number;
  /** True when reach is added up across posts or 30-day slices, so one person can count more than once. */
  reachIsSummed: boolean;
  /** "account" = everything people saw in the window; "posts" = only posts published in the window. */
  viewsSource: "account" | "posts";
  avgWatchSec: number | null;
  sharesAndSaves: number;
  postsPublished: number;
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`;

export function ToplineCards({
  current,
  channel,
  loading,
}: {
  current?: ToplineMetrics;
  channel: "instagram" | "facebook";
  loading?: boolean;
}) {
  if (loading || !current) {
    return (
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-1 h-7 w-16" />
              <Skeleton className="mt-1 h-3 w-24" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  const fromPosts = current.viewsSource === "posts";
  const postsNote = `from ${current.postsPublished.toLocaleString()} ${current.postsPublished === 1 ? "post" : "posts"} in this period`;
  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      <Tile
        label="Followers"
        value={current.followers.total == null ? "—" : current.followers.total.toLocaleString()}
        note={current.followers.change == null ? "change shows after a second day of data" : `${signed(current.followers.change)} in this period`}
      />
      <Tile label="Views" value={current.views.toLocaleString()} note={fromPosts ? postsNote : "across the whole account"} />
      <Tile
        label="Reach"
        value={current.reach.toLocaleString()}
        note={current.reachIsSummed ? "added up, so a person can count more than once" : fromPosts ? postsNote : "unique accounts"}
      />
      {channel === "instagram" ? (
        <Tile
          label="Avg watch time"
          value={current.avgWatchSec == null ? "—" : `${current.avgWatchSec.toFixed(1)}s`}
          note={current.avgWatchSec == null ? "no Reels in this period" : "per view, Reels in this period"}
        />
      ) : (
        <Tile label="Avg watch time" value="—" note="not reported by Facebook" />
      )}
      <Tile label="Shares + saves" value={current.sharesAndSaves.toLocaleString()} note={postsNote} />
      <Tile label="Posts published" value={current.postsPublished.toLocaleString()} note="in this period" />
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardHeader>
    </Card>
  );
}
