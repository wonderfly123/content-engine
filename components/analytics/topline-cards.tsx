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
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      <Tile
        label="Followers"
        value={current.followers.total == null ? "—" : current.followers.total.toLocaleString()}
        note={current.followers.change == null ? undefined : signed(current.followers.change)}
      />
      <Tile label="Views" value={current.views.toLocaleString()} />
      <Tile label="Reach" value={current.reach.toLocaleString()} />
      <Tile
        label="Avg watch time"
        value={channel === "instagram" && current.avgWatchSec != null ? `${current.avgWatchSec.toFixed(1)}s` : "—"}
      />
      <Tile label="Shares + saves" value={current.sharesAndSaves.toLocaleString()} />
      <Tile label="Posts published" value={current.postsPublished.toLocaleString()} />
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardHeader>
    </Card>
  );
}
