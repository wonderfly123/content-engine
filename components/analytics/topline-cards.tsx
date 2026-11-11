"use client";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Summary for one channel over the selected window (see /api/analytics/topline). */
export interface ToplineMetrics {
  followers: { total: number | null; gained: number | null; lost: number | null; net: number | null };
  views: number;
  sharesPer1kViews: number | null;
  savesPer1kViews: number | null;
  stayedPast3sPct: number | null;
  postsPublished: number;
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
const rate = (n: number | null) => (n == null ? "—" : n >= 10 ? n.toFixed(0) : n.toFixed(1));

/** Ordered for follower growth: the goal first, then the things that drive it. */
export function ToplineCards({
  current,
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
  const f = current.followers;
  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      <Tile label="Followers" value={f.total == null ? "—" : f.total.toLocaleString()} />
      <Tile
        label="Net new followers"
        value={f.net == null ? "—" : signed(f.net)}
        note={f.gained != null && f.lost != null ? `${f.gained.toLocaleString()} gained · ${f.lost.toLocaleString()} lost` : undefined}
      />
      <Tile label="Views" value={current.views.toLocaleString()} />
      <Tile label="Shares per 1K views" value={rate(current.sharesPer1kViews)} />
      <Tile label="Saves per 1K views" value={rate(current.savesPer1kViews)} />
      <Tile label="Stayed past 3 sec" value={current.stayedPast3sPct == null ? "—" : `${current.stayedPast3sPct.toFixed(0)}%`} />
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
