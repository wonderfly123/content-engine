"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FilterBar } from "@/components/analytics/filter-bar";
import {
  ToplineCards,
  type ToplineDeltas,
  type ToplineMetrics,
} from "@/components/analytics/topline-cards";
import { TrendCharts } from "@/components/analytics/trend-charts";
import { CalloutCards } from "@/components/analytics/callout-cards";
import { PostTable, type AnalyticsPostRow } from "@/components/analytics/post-table";
import { useBrandStore } from "@/lib/stores/brand-store";

interface TrendsPayload {
  reach: Array<Record<string, number | string>>;
  engagement: Array<Record<string, number | string>>;
  followers: Array<Record<string, number | string>>;
  split: "all" | "channel";
}

export default function AnalyticsPage() {
  const brand = useBrandStore((s) => s.active);
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [topline, setTopline] = useState<{
    current: ToplineMetrics;
    deltas: ToplineDeltas;
  } | null>(null);
  const [trends, setTrends] = useState<TrendsPayload | null>(null);
  const [posts, setPosts] = useState<AnalyticsPostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Brand callouts — could come from /api/brands/[id]; for now read empty.
  const [whatWorks] = useState<string[] | undefined>(undefined);
  const [whatToAvoid] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    if (!brand) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams(qs);
    params.set("brandId", brand.id);
    const u = (path: string) => `/api/analytics/${path}?${params.toString()}`;

    Promise.all([
      fetch(u("topline")).then((r) => r.json()),
      fetch(u("trends")).then((r) => r.json()),
      fetch(u("posts")).then((r) => r.json()),
    ])
      .then(([t, tr, p]) => {
        if (cancelled) return;
        if (t.data) {
          setTopline({ current: t.data.current, deltas: t.data.deltas });
        }
        if (tr.data) setTrends(tr.data);
        if (p.data) setPosts(p.data.posts);
        setLastSynced(new Date().toLocaleString());
      })
      .catch(() => {
        if (!cancelled) {
          setTopline(null);
          setTrends(null);
          setPosts([]);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [brand, qs]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Analytics</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Unified live view with filters; click any row to drill into provenance.
        </p>
      </div>

      <FilterBar lastSyncedAt={lastSynced} />

      <ToplineCards
        current={topline?.current}
        deltas={topline?.deltas}
        loading={loading || !topline}
      />

      {trends ? (
        <TrendCharts
          reach={trends.reach as never}
          engagement={trends.engagement as never}
          followers={trends.followers as never}
          split={trends.split}
        />
      ) : (
        <div className="grid h-48 gap-4 lg:grid-cols-3">
          <div className="rounded-md border bg-card" />
          <div className="rounded-md border bg-card" />
          <div className="rounded-md border bg-card" />
        </div>
      )}

      <CalloutCards whatWorks={whatWorks} whatToAvoid={whatToAvoid} />

      <PostTable rows={posts} loading={loading} />
    </div>
  );
}
