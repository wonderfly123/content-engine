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
import { toast } from "sonner";
import { useBrandStore } from "@/lib/stores/brand-store";
import type { Channel } from "@/lib/db/enums";

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
  const [enabledChannels, setEnabledChannels] = useState<Channel[] | null>(null);
  const [posts, setPosts] = useState<AnalyticsPostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

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
          if (Array.isArray(t.data.enabledChannels)) {
            setEnabledChannels(t.data.enabledChannels as Channel[]);
          }
        }
        if (tr.data) setTrends(tr.data);
        if (p.data) setPosts(p.data.posts);
        // When the numbers were last pulled from Instagram / Facebook, not when this page loaded.
        setLastSynced(tr.data?.lastSyncedAt ? new Date(tr.data.lastSyncedAt).toLocaleString() : "never");
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
  }, [brand, qs, reloadKey]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/analytics/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReloadKey((k) => k + 1);
    } catch {
      toast.error("Couldn't pull fresh numbers. Try again in a minute.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Organic</h2>

      <FilterBar lastSyncedAt={lastSynced} enabledChannels={enabledChannels} onRefresh={refresh} refreshing={refreshing} />

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
