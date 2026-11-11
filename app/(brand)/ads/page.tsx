"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AdsTopline,
  type AdsToplineMetrics,
} from "@/components/ads/ads-topline";
import { SpendTrend, type AdsDailyPoint } from "@/components/ads/spend-trend";
import {
  CampaignTable,
  type AdCampaignRow,
} from "@/components/ads/campaign-table";
import { useBrandStore } from "@/lib/stores/brand-store";

const DAYS = 30;

interface AdsSummaryPayload {
  topline: AdsToplineMetrics;
  daily: AdsDailyPoint[];
}

async function fetchSummary(
  brandId: string | undefined,
): Promise<AdsSummaryPayload> {
  if (!brandId) return { topline: emptyTopline(), daily: [] };
  const params = new URLSearchParams({ brandId, days: String(DAYS) });
  const res = await fetch(`/api/ads/summary?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data: AdsSummaryPayload | null };
  if (!json.data) throw new Error("Empty response");
  return json.data;
}

async function fetchCampaigns(
  brandId: string | undefined,
): Promise<AdCampaignRow[]> {
  if (!brandId) return [];
  const params = new URLSearchParams({ brandId });
  const res = await fetch(`/api/ads/campaigns?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    data: { campaigns: AdCampaignRow[] } | null;
  };
  return json.data?.campaigns ?? [];
}

function emptyTopline(): AdsToplineMetrics {
  return { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0 };
}

export default function AdsPage() {
  const active = useBrandStore((s) => s.active);
  const looksLikeUuid =
    typeof active?.id === "string" && /^[0-9a-f-]{36}$/i.test(active.id);
  const brandId = looksLikeUuid ? active!.id : undefined;

  const summary = useQuery({
    queryKey: ["ads-summary", brandId, DAYS],
    queryFn: () => fetchSummary(brandId),
    enabled: Boolean(brandId),
  });

  const campaigns = useQuery({
    queryKey: ["ads-campaigns", brandId],
    queryFn: () => fetchCampaigns(brandId),
    enabled: Boolean(brandId),
  });

  const summaryLoading = Boolean(brandId) && summary.isLoading;
  const campaignsLoading = Boolean(brandId) && campaigns.isLoading;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Paid</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paid performance from the daily Meta ingest — spend, delivery, and
          campaign results over the last {DAYS} days.
        </p>
      </div>

      {summary.isError && (
        <p className="text-sm text-destructive">Failed to load ad summary.</p>
      )}
      <AdsTopline
        topline={summary.data?.topline}
        days={DAYS}
        loading={summaryLoading}
      />

      <SpendTrend
        daily={summary.data?.daily}
        days={DAYS}
        loading={summaryLoading}
      />

      {campaigns.isError ? (
        <p className="text-sm text-destructive">Failed to load campaigns.</p>
      ) : (
        <CampaignTable
          rows={campaigns.data ?? []}
          loading={campaignsLoading}
        />
      )}
    </div>
  );
}
