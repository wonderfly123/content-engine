"use client";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatCurrency, formatPercent } from "./format";

export interface AdsToplineMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  /** Fraction (0-1). */
  ctr: number;
  /** Dollars per click. */
  cpc: number;
}

export function AdsTopline({
  topline,
  days,
  loading,
}: {
  topline?: AdsToplineMetrics;
  days: number;
  loading?: boolean;
}) {
  if (loading || !topline) {
    return (
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
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

  const caption = `Last ${days} days`;
  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
      <Tile label="Spend" value={formatCurrency(topline.spend)} caption={caption} />
      <Tile
        label="Impressions"
        value={formatCount(topline.impressions)}
        caption={caption}
      />
      <Tile label="Clicks" value={formatCount(topline.clicks)} caption={caption} />
      <Tile
        label="CTR"
        value={formatPercent(topline.ctr)}
        caption="Blended, clicks / impressions"
      />
      <Tile
        label="CPC"
        value={formatCurrency(topline.cpc)}
        caption="Blended, spend / clicks"
      />
    </div>
  );
}

function Tile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        <div className="text-xs text-muted-foreground">{caption}</div>
      </CardHeader>
    </Card>
  );
}
