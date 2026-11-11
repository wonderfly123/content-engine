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
  parseFilters,
  serializeFilters,
  type AnalyticsFilters,
  type DateRangePreset,
} from "@/lib/analytics/filters";

export function FilterBar({
  lastSyncedAt,
  enabledChannels,
}: {
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

  const update = useCallback(
    (next: Partial<AnalyticsFilters>) => {
      const merged: AnalyticsFilters = { ...filters, ...next };
      router.replace(`/analytics?${serializeFilters(merged).toString()}`);
    },
    [router, filters],
  );

  const toggleArray = <T extends string>(arr: T[], item: T): T[] =>
    arr.includes(item) ? arr.filter((a) => a !== item) : [...arr, item];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
      <span className="text-xs text-muted-foreground">Filters:</span>

      <div className="flex flex-wrap gap-1">
        {visibleChannels.map((c) => {
          const on = filters.channels.includes(c);
          return (
            <Button
              key={c}
              variant={on ? "default" : "outline"}
              size="sm"
              onClick={() =>
                update({ channels: toggleArray<Channel>(filters.channels, c) })
              }
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
        <SelectTrigger className="h-7 w-[110px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
          <SelectItem value="90d">Last 90 days</SelectItem>
        </SelectContent>
      </Select>

      <div className="ml-auto text-xs text-muted-foreground">
        Last synced: {lastSyncedAt ?? "—"}
      </div>
    </div>
  );
}
