/**
 * Server-side analytics aggregations.
 *
 * Inputs are the latest analytics_snapshot per post joined with posts +
 * drafts (for format/channel). Aggregation is pure: it takes plain arrays
 * so it is trivial to unit-test without DB.
 */

import type { Channel, ContentFormat } from "@/lib/db/enums";
import type { AnalyticsFilters } from "./filters";

export interface PostAggRow {
  postId: string;
  brandId: string;
  channel: Channel;
  format: ContentFormat;
  icpId: string | null;
  publishedAt: Date | null;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  followsFromPost: number | null;
  /** Reels only: average seconds watched per view. */
  avgWatchSec?: number | null;
  /** Newer Reels only: percent of views that left within the first 3 seconds (0-100). */
  skipRate?: number | null;
  /** Video length, known only for posts made through the engine (Instagram does not report it). */
  durationSec?: number | null;
  /** Trial Reels are shown to non-followers only, so they are not comparable with normal posts. */
  isTrial?: boolean;
}

export interface ToplineMetrics {
  totalReach: number;
  engagementRate: number; // fraction
  followerDelta: number;
  postsPublished: number;
  avgReachPerPost: number;
  topFormat: { format: ContentFormat | null; avgEr: number };
}

/** What the summary cards show for one channel over the selected window. */
export interface ChannelSummary {
  postsPublished: number;
  /** Sums over the posts published in the window. */
  views: number;
  reach: number;
  sharesAndSaves: number;
  /** How often a view turns into a share / a save. Null when the window has no views. */
  sharesPer1kViews: number | null;
  savesPer1kViews: number | null;
  /** Percent of views that stayed past the first 3 seconds, weighted by views; null when no Reel reports it. */
  stayedPast3sPct: number | null;
  /** Average seconds watched per view across Reels, weighted by views; null when no Reel reports it. */
  avgWatchSec: number | null;
}

/** Views-weighted mean of `value` over the rows that have one. */
function weightedByViews(rows: PostAggRow[], value: (r: PostAggRow) => number | null | undefined): number | null {
  let total = 0;
  let weight = 0;
  for (const r of rows) {
    const v = value(r);
    if (v == null) continue;
    // A post with a value but no recorded views still counts once, so it cannot vanish from the average.
    const w = Math.max(r.impressions ?? 0, 1);
    total += v * w;
    weight += w;
  }
  return weight > 0 ? total / weight : null;
}

export function summarizePosts(rows: PostAggRow[]): ChannelSummary {
  const views = sum(rows.map((r) => r.impressions ?? 0));
  const shares = sum(rows.map((r) => r.shares ?? 0));
  const saves = sum(rows.map((r) => r.saves ?? 0));
  return {
    postsPublished: rows.length,
    views,
    reach: sum(rows.map((r) => r.reach ?? 0)),
    sharesAndSaves: shares + saves,
    sharesPer1kViews: views > 0 ? (shares / views) * 1000 : null,
    savesPer1kViews: views > 0 ? (saves / views) * 1000 : null,
    stayedPast3sPct: weightedByViews(rows, (r) => (r.skipRate == null ? null : 100 - r.skipRate)),
    avgWatchSec: weightedByViews(rows, (r) => r.avgWatchSec),
  };
}

/**
 * "Your typical post": the median views of comparable posts, so one viral post does not move it.
 * Trial Reels are compared only with other trial Reels; with fewer than 3 comparable posts there
 * is no baseline (null) rather than a misleading one.
 */
export function typicalViews(rows: PostAggRow[], like: { format: ContentFormat; isTrial?: boolean }): number | null {
  const peers = rows
    .filter((r) => r.format === like.format && Boolean(r.isTrial) === Boolean(like.isTrial) && (r.impressions ?? 0) > 0)
    .map((r) => r.impressions ?? 0)
    .sort((a, b) => a - b);
  if (peers.length < 3) return null;
  const mid = Math.floor(peers.length / 2);
  return peers.length % 2 ? peers[mid]! : (peers[mid - 1]! + peers[mid]!) / 2;
}

/** Views per day the post was published on (the dependable volume number; reach is unreliable for old Reels). */
export function buildViewsTrend(rows: PostAggRow[]): TrendPoint[] {
  const buckets = new Map<string, number>();
  rows.forEach((r) => {
    if (!r.publishedAt) return;
    const day = isoDay(r.publishedAt);
    buckets.set(day, (buckets.get(day) ?? 0) + (r.impressions ?? 0));
  });
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, views]) => ({ date, views }));
}

export function filterRows(
  rows: PostAggRow[],
  f: AnalyticsFilters,
  range: { start: Date; end: Date },
): PostAggRow[] {
  return rows.filter((r) => {
    if (!r.publishedAt) return false;
    if (r.publishedAt < range.start || r.publishedAt > range.end) return false;
    if (f.channels.length && !f.channels.includes(r.channel)) return false;
    if (f.formats.length && !f.formats.includes(r.format)) return false;
    if (f.icpId && r.icpId !== f.icpId) return false;
    return true;
  });
}

export function computeTopline(
  rows: PostAggRow[],
  followerDelta: number,
): ToplineMetrics {
  const postsPublished = rows.length;
  const totalReach = sum(rows.map((r) => r.reach ?? 0));
  const engagement = rows.map((r) => engagementOf(r));
  const engagementRate =
    engagement.length === 0 ? 0 : avg(engagement.map((e) => e.rate));
  const avgReachPerPost = postsPublished === 0 ? 0 : totalReach / postsPublished;

  // Top format by avg ER.
  const byFormat = new Map<ContentFormat, number[]>();
  rows.forEach((r) => {
    const arr = byFormat.get(r.format) ?? [];
    arr.push(engagementOf(r).rate);
    byFormat.set(r.format, arr);
  });
  let topFormat: { format: ContentFormat | null; avgEr: number } = {
    format: null,
    avgEr: 0,
  };
  byFormat.forEach((arr, format) => {
    const a = avg(arr);
    if (a > topFormat.avgEr) topFormat = { format, avgEr: a };
  });

  return {
    totalReach,
    engagementRate,
    followerDelta,
    postsPublished,
    avgReachPerPost,
    topFormat,
  };
}

/**
 * Engagement rate = (likes + comments + shares + saves) / views.
 *
 * Views is the base, not reach: Instagram reports a tiny reach for older Reels (5 accounts
 * "reached" on a Reel with 3,500 views and 150 likes), which produced rates of several hundred
 * percent. Reach is the fallback for posts with no views figure (photos); a post with neither
 * has no rate at all (`measurable: false`) and is left out of averages.
 */
export function engagementOf(r: PostAggRow): { interactions: number; rate: number; measurable: boolean } {
  const interactions =
    (r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0) + (r.saves ?? 0);
  const base = (r.impressions ?? 0) > 0 ? (r.impressions ?? 0) : (r.reach ?? 0);
  return { interactions, rate: base > 0 ? interactions / base : 0, measurable: base > 0 };
}

export interface TrendPoint {
  date: string; // ISO yyyy-mm-dd
  [series: string]: number | string;
}

/** Bucket rows by day. `series` is either "all" or a per-channel split. */
export function buildReachTrend(
  rows: PostAggRow[],
  split: "all" | "channel",
): TrendPoint[] {
  const buckets = new Map<string, Map<string, number>>();
  rows.forEach((r) => {
    if (!r.publishedAt) return;
    const day = isoDay(r.publishedAt);
    const bucket = buckets.get(day) ?? new Map<string, number>();
    const key = split === "channel" ? r.channel : "reach";
    bucket.set(key, (bucket.get(key) ?? 0) + (r.reach ?? 0));
    buckets.set(day, bucket);
  });
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, m]) => {
      const point: TrendPoint = { date };
      m.forEach((v, k) => {
        point[k] = v;
      });
      return point;
    });
}

export function buildEngagementTrend(rows: PostAggRow[]): TrendPoint[] {
  const buckets = new Map<string, { sumRate: number; n: number }>();
  rows.forEach((r) => {
    if (!r.publishedAt) return;
    const day = isoDay(r.publishedAt);
    const e = engagementOf(r);
    if (!e.measurable) return;
    const cur = buckets.get(day) ?? { sumRate: 0, n: 0 };
    cur.sumRate += e.rate;
    cur.n += 1;
    buckets.set(day, cur);
  });
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, { sumRate, n }]) => ({ date, er: n ? sumRate / n : 0 }));
}

/**
 * Follower snapshots arrive per channel (Instagram, Facebook, ...). Collapse them into one
 * brand-wide point per day: the sum of each channel's latest known count, carrying a channel's
 * last value forward on days it was not sampled. Without this, two channels sampled on the same
 * day read as a jump from one channel's count to the other's.
 */
export function combineFollowerSeries(
  rows: Array<{ pulledAt: Date; channel: string; followerCount: number | null }>,
): Array<{ pulledAt: Date; followerCount: number | null }> {
  const sorted = rows
    .filter((r) => r.followerCount != null)
    .sort((a, b) => a.pulledAt.getTime() - b.pulledAt.getTime());
  const latestByChannel = new Map<string, number>();
  const byDay = new Map<string, { pulledAt: Date; followerCount: number }>();
  for (const r of sorted) {
    latestByChannel.set(r.channel, r.followerCount ?? 0);
    byDay.set(isoDay(r.pulledAt), {
      pulledAt: r.pulledAt,
      followerCount: sum([...latestByChannel.values()]),
    });
  }
  return [...byDay.values()];
}

export function buildFollowerTrend(
  followerSeries: Array<{ pulledAt: Date; followerCount: number | null }>,
): TrendPoint[] {
  const sorted = [...followerSeries]
    .filter((s) => s.followerCount != null)
    .sort((a, b) => a.pulledAt.getTime() - b.pulledAt.getTime());
  return sorted.map((s) => ({
    date: isoDay(s.pulledAt),
    followers: s.followerCount ?? 0,
  }));
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
