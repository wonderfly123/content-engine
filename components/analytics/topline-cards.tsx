"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  computeDelta,
  formatAbs,
  formatPct,
  type Delta,
} from "@/lib/analytics/delta";

export interface ToplineMetrics {
  totalReach: number;
  engagementRate: number;
  followerDelta: number;
  postsPublished: number;
  avgReachPerPost: number;
  topFormat: { format: string | null; avgEr: number };
}

export interface ToplineDeltas {
  totalReach: Delta;
  engagementRate: Delta;
  followerDelta: Delta;
  postsPublished: Delta;
  avgReachPerPost: Delta;
  topFormatEr: Delta;
}

export function ToplineCards({
  current,
  deltas,
  loading,
}: {
  current?: ToplineMetrics;
  deltas?: ToplineDeltas;
  loading?: boolean;
}) {
  if (loading || !current || !deltas) {
    return (
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-1 h-7 w-16" />
              <Skeleton className="mt-1 h-3 w-12" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      <Tile
        label="Total reach"
        value={current.totalReach.toLocaleString()}
        delta={deltas.totalReach}
      />
      <Tile
        label="Engagement rate"
        value={`${(current.engagementRate * 100).toFixed(1)}%`}
        delta={deltas.engagementRate}
        deltaMode="pct"
      />
      <Tile
        label="Follower Δ"
        value={formatAbs(current.followerDelta)}
        delta={deltas.followerDelta}
      />
      <Tile
        label="Posts published"
        value={current.postsPublished.toLocaleString()}
        delta={deltas.postsPublished}
      />
      <Tile
        label="Avg reach / post"
        value={Math.round(current.avgReachPerPost).toLocaleString()}
        delta={deltas.avgReachPerPost}
      />
      <Tile
        label="Top format"
        value={current.topFormat.format ?? "—"}
        delta={deltas.topFormatEr}
        deltaMode="pct"
      />
    </div>
  );
}

function Tile({
  label,
  value,
  delta,
  deltaMode = "pct",
}: {
  label: string;
  value: string;
  delta: Delta;
  deltaMode?: "pct" | "abs";
}) {
  const dir = delta.direction;
  const Icon =
    dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : ArrowRight;
  const color =
    dir === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : dir === "down"
      ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums capitalize">{value}</CardTitle>
        <div className={`flex items-center gap-1 text-xs ${color}`}>
          <Icon className="h-3.5 w-3.5" />
          <span className="tabular-nums">
            {deltaMode === "pct" ? formatPct(delta.pct) : formatAbs(delta.abs)}
          </span>
          <span className="text-muted-foreground">vs prior</span>
        </div>
      </CardHeader>
    </Card>
  );
}

// Re-export so the page can construct the deltas type without importing from
// the route file (which is server-only).
export { computeDelta };
