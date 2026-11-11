/**
 * Server-only data loaders for the analytics endpoints. Centralised here so
 * all four endpoints (topline, trends, posts, post/[id]) share the same join
 * shape and there is no N+1.
 */

import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  analyticsSnapshots,
  brandMetricsSnapshots,
  brands,
  briefs,
  drafts,
  posts,
} from "@/lib/db/schema";
import type { Channel } from "@/lib/db/enums";
import type { BrandSettings } from "@/lib/db/types";
import { combineFollowerSeries, type PostAggRow } from "./aggregate";
import { resolveEnabledChannels } from "./filters";

/**
 * Loads the brand's analytics-enabled channels from settings_json.
 * Absent key = all channels enabled (backward compatible).
 */
export async function loadEnabledChannels(brandId: string): Promise<Channel[]> {
  const [row] = await db
    .select({ settingsJson: brands.settingsJson })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  return resolveEnabledChannels(
    (row?.settingsJson ?? null) as BrandSettings | null,
  );
}

/**
 * Returns one row per published post in [from, to] with that post's latest
 * analytics snapshot stitched in. Filtering by channel/format/icp is done
 * in JS via `filterRows` — the SQL stays simple and cacheable. When
 * `enabledChannels` is provided, disabled channels are excluded server-side
 * (WHERE channel IN (...)) so they never reach any aggregation.
 */
export async function loadPostAggRows(
  brandId: string,
  from: Date,
  to: Date,
  enabledChannels?: Channel[],
): Promise<PostAggRow[]> {
  // Explicit empty list = every channel disabled; nothing to show.
  if (enabledChannels && enabledChannels.length === 0) return [];
  const latest = db.$with("latest").as(
    db
      .select({
        postId: analyticsSnapshots.postId,
        maxPulledAt:
          sql<Date>`max(${analyticsSnapshots.pulledAt})`.as("max_pulled_at"),
      })
      .from(analyticsSnapshots)
      .groupBy(analyticsSnapshots.postId),
  );

  const rows = await db
    .with(latest)
    .select({
      postId: posts.id,
      brandId: posts.brandId,
      channel: posts.channel,
      format: drafts.format,
      icpId: briefs.icpId,
      publishedAt: posts.publishedAt,
      reach: analyticsSnapshots.reach,
      impressions: analyticsSnapshots.impressions,
      likes: analyticsSnapshots.likes,
      comments: analyticsSnapshots.comments,
      shares: analyticsSnapshots.shares,
      saves: analyticsSnapshots.saves,
      followsFromPost: analyticsSnapshots.followsFromPost,
      rawJson: analyticsSnapshots.rawJson,
      draftMeta: drafts.metaJson,
      durationSec: sql<number | null>`(select max(a.duration_sec) from draft_assets da join assets a on a.id = da.asset_id where da.draft_id = ${drafts.id})`,
    })
    .from(posts)
    .innerJoin(drafts, eq(drafts.id, posts.draftId))
    .innerJoin(briefs, eq(briefs.id, drafts.briefId))
    .leftJoin(latest, eq(latest.postId, posts.id))
    .leftJoin(
      analyticsSnapshots,
      and(
        eq(analyticsSnapshots.postId, posts.id),
        eq(analyticsSnapshots.pulledAt, latest.maxPulledAt),
      ),
    )
    .where(
      and(
        eq(posts.brandId, brandId),
        eq(posts.status, "published"),
        gte(posts.publishedAt, from),
        lte(posts.publishedAt, to),
        enabledChannels ? inArray(posts.channel, enabledChannels) : undefined,
      ),
    );

  return rows.map((r) => ({
    postId: r.postId,
    brandId: r.brandId,
    channel: r.channel,
    format: r.format,
    icpId: r.icpId,
    publishedAt: r.publishedAt,
    reach: r.reach,
    impressions: r.impressions,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
    saves: r.saves,
    followsFromPost: r.followsFromPost,
    avgWatchSec: insightFrom(r.rawJson, "ig_reels_avg_watch_time", 1 / 1000),
    // Instagram only began counting 3-second skips recently, but still divides by lifetime views, so
    // older Reels report absurdly low skip rates (0.3% on a 164K-view Reel from 2024). Trust it only
    // for posts from the last 12 months.
    skipRate:
      r.publishedAt && Date.now() - r.publishedAt.getTime() < 365 * 24 * 60 * 60 * 1000
        ? insightFrom(r.rawJson, "reels_skip_rate", 1)
        : null,
    durationSec: r.durationSec == null ? null : Number(r.durationSec),
    isTrial: r.draftMeta?.trialReel === "manual" || r.draftMeta?.trialReel === "auto",
  }));
}

/** Reads one metric out of the raw Instagram insights payload stored with each snapshot. */
function insightFrom(raw: unknown, name: string, scale: number): number | null {
  const data = (raw as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> } | null)?.data;
  const value = data?.find((d) => d.name === name)?.values?.[0]?.value;
  return typeof value === "number" ? value * scale : null;
}

/** Brand-wide follower totals, one point per day (channels summed; see combineFollowerSeries). */
export async function loadFollowerSeries(
  brandId: string,
  from: Date,
  to: Date,
  channel?: Channel,
): Promise<Array<{ pulledAt: Date; followerCount: number | null }>> {
  const rows = await db
    .select({
      pulledAt: brandMetricsSnapshots.pulledAt,
      channel: brandMetricsSnapshots.channel,
      followerCount: brandMetricsSnapshots.followerCount,
    })
    .from(brandMetricsSnapshots)
    .where(
      and(
        eq(brandMetricsSnapshots.brandId, brandId),
        gte(brandMetricsSnapshots.pulledAt, from),
        lte(brandMetricsSnapshots.pulledAt, to),
        channel ? eq(brandMetricsSnapshots.channel, channel) : undefined,
      ),
    )
    .orderBy(brandMetricsSnapshots.pulledAt);
  return combineFollowerSeries(rows);
}

/** When post numbers were last pulled from the platforms for this brand (null = never). */
export async function loadLastSyncedAt(brandId: string): Promise<Date | null> {
  const rows = await db
    .select({ pulledAt: analyticsSnapshots.pulledAt })
    .from(analyticsSnapshots)
    .where(eq(analyticsSnapshots.brandId, brandId))
    .orderBy(desc(analyticsSnapshots.pulledAt))
    .limit(1);
  return rows[0]?.pulledAt ?? null;
}
