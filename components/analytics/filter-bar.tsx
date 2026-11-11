"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Channel } from "@/lib/db/enums";
import {
  activeChannel,
  parseFilters,
  serializeFilters,
  type AnalyticsFilters,
  type DateRangePreset,
} from "@/lib/analytics/filters";

export function FilterBar({
  lastSyncedAt,
  enabledChannels,
  onRefresh,
  refreshing,
}: {
  /** Pull fresh numbers from the platforms now. */
  onRefresh?: () => void;
  refreshing?: boolean;
  lastSyncedAt?: string | null;
  /** Brand's analytics-enabled channels; undefined/null = show all. */
  enabledChannels?: Channel[] | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters: AnalyticsFilters = parseFilters(
    new URLSearchParams(searchParams.toString()),
  );
  // Only the channels this app actually posts to. A brand can narrow this further in Settings.
  const SUPPORTED: Channel[] = ["instagram", "facebook"];
  const visibleChannels = SUPPORTED.filter((c) => !enabledChannels || enabledChannels.includes(c));

  const current = activeChannel(filters);

  const update = useCallback(
    (next: Partial<AnalyticsFilters>) => {
      const merged: AnalyticsFilters = { ...filters, ...next };
      router.replace(`/analytics?${serializeFilters(merged).toString()}`);
    },
    [router, filters],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
      {/* One channel at a time: Instagram and Facebook numbers are not comparable, so they are never added together. */}
      <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Channel">
        {visibleChannels.map((c) => {
          const on = current === c;
          return (
            <Button
              key={c}
              role="tab"
              aria-selected={on}
              variant={on ? "default" : "ghost"}
              size="sm"
              onClick={() => update({ channels: [c] })}
              className="h-7 capitalize"
            >
              {c}
            </Button>
          );
        })}
      </div>

      <Select
        value={filters.dateRange}
        onValueChange={(v) => update({ dateRange: v as DateRangePreset })}
      >
        <SelectTrigger className="h-7 w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
          <SelectItem value="90d">Last 90 days</SelectItem>
          <SelectItem value="all">All time</SelectItem>
        </SelectContent>
      </Select>

      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span>Last synced: {lastSyncedAt ?? "—"}</span>
        {onRefresh && (
          <Button variant="outline" size="sm" className="h-7" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh now"}
          </Button>
        )}
      </div>
    </div>
  );
}
