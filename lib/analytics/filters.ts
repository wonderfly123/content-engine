/**
 * URL-bound analytics filter parsing.
 *
 * The analytics page state lives entirely in the URL search params so links
 * are bookmarkable and shareable. Server components read with
 * `parseFilters(searchParams)`; client components mutate via Next.js router
 * after re-serializing with `serializeFilters`.
 */

import { channelValues, formatValues } from "@/lib/db/enums";
import type { Channel, ContentFormat } from "@/lib/db/enums";
import type { BrandSettings } from "@/lib/db/types";

export type DateRangePreset = "7d" | "30d" | "90d" | "all" | "custom";

export interface AnalyticsFilters {
  channels: Channel[];
  formats: ContentFormat[];
  icpId: string | null;
  dateRange: DateRangePreset;
  /** ISO yyyy-mm-dd. Only meaningful when dateRange === 'custom'. */
  from: string | null;
  to: string | null;
}

const ALL_CHANNELS = new Set<string>(channelValues);
const ALL_FORMATS = new Set<string>(formatValues);

export function parseFilters(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): AnalyticsFilters {
  const get = (k: string): string | null => {
    if (sp instanceof URLSearchParams) return sp.get(k);
    const v = sp[k];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };
  const getAll = (k: string): string[] => {
    if (sp instanceof URLSearchParams) return sp.getAll(k);
    const v = sp[k];
    if (Array.isArray(v)) return v;
    return v ? [v] : [];
  };

  const rawChannels = (get("channel") ?? "").split(",").filter(Boolean);
  const channels = (rawChannels.length ? rawChannels : getAll("channel"))
    .filter((c) => ALL_CHANNELS.has(c)) as Channel[];

  const rawFormats = (get("format") ?? "").split(",").filter(Boolean);
  const formats = (rawFormats.length ? rawFormats : getAll("format"))
    .filter((f) => ALL_FORMATS.has(f)) as ContentFormat[];

  const dr = (get("range") ?? "30d") as DateRangePreset;
  const dateRange: DateRangePreset =
    dr === "7d" || dr === "30d" || dr === "90d" || dr === "all" || dr === "custom" ? dr : "30d";

  return {
    channels,
    formats,
    icpId: get("icp"),
    dateRange,
    from: get("from"),
    to: get("to"),
  };
}

export function serializeFilters(f: AnalyticsFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.channels.length) sp.set("channel", f.channels.join(","));
  if (f.formats.length) sp.set("format", f.formats.join(","));
  if (f.icpId) sp.set("icp", f.icpId);
  if (f.dateRange !== "30d") sp.set("range", f.dateRange);
  if (f.dateRange === "custom") {
    if (f.from) sp.set("from", f.from);
    if (f.to) sp.set("to", f.to);
  }
  return sp;
}

/**
 * Resolves which channels a brand has enabled for analytics.
 * Absent/undefined settings key = all channels (backward compatible).
 * Unknown values are dropped defensively.
 */
export function resolveEnabledChannels(
  settings: BrandSettings | null | undefined,
): Channel[] {
  const enabled = settings?.enabledChannels;
  if (!Array.isArray(enabled)) return [...channelValues];
  return enabled.filter((c): c is Channel => ALL_CHANNELS.has(c));
}

/** Resolves the absolute time window the filter currently denotes. */
export function resolveRange(f: AnalyticsFilters, now: Date = new Date()): {
  start: Date;
  end: Date;
} {
  if (f.dateRange === "custom" && f.from && f.to) {
    return { start: new Date(f.from + "T00:00:00Z"), end: new Date(f.to + "T23:59:59Z") };
  }
  if (f.dateRange === "all") {
    // Before Instagram existed, so every post ever published is inside the window.
    return { start: new Date("2010-01-01T00:00:00Z"), end: new Date(now) };
  }
  const days = f.dateRange === "7d" ? 7 : f.dateRange === "90d" ? 90 : 30;
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return { start, end };
}

/** Channels the Organic page reports on. Each is shown separately: their numbers are not comparable. */
export const ANALYTICS_CHANNELS = ["instagram", "facebook"] as const;
export type AnalyticsChannel = (typeof ANALYTICS_CHANNELS)[number];

/** The one channel being viewed (Instagram unless Facebook is selected). */
export function activeChannel(f: AnalyticsFilters): AnalyticsChannel {
  return f.channels.includes("facebook") && !f.channels.includes("instagram") ? "facebook" : "instagram";
}
