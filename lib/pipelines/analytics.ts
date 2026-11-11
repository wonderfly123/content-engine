/**
 * Pipeline 5b — Analytics pull (hot + cold). Section 6 of the spec.
 *
 * Hot: posts published in the last 7 days, last snapshot >1h ago → hourly cron.
 * Cold: posts published 7-30d ago, last snapshot >24h ago → daily cron.
 *
 * Analytics rows are TIME SERIES — we always INSERT, never UPDATE.
 *
 * Once per brand × channel per day we also refresh `brand_metrics_snapshots`
 * (follower / following / total posts) so the analytics page can show
 * follower growth.
 */

import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import { fetchAccountMetrics } from "@/lib/publishing/meta-graph";
import {
  getPublisher,
  type AnalyticsSnapshot,
  type Publisher,
} from "@/lib/publishing";

export type DbOrTx = typeof defaultDb;

export interface AnalyticsDeps {
  db?: DbOrTx;
  getPublisherFor?: (
    channel: "instagram" | "facebook",
  ) => Publisher;
  now?: () => Date;
  limit?: number;
}

export interface AnalyticsResult {
  pulled: number;
  failed: number;
}

const HOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COLD_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HOT_INTERVAL_MS = 60 * 60 * 1000; // 1h
const COLD_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export async function pullAnalyticsHot(
  deps: AnalyticsDeps = {},
): Promise<AnalyticsResult> {
  return pullAnalytics({
    ...deps,
    minAgeMs: 0,
    maxAgeMs: HOT_AGE_MS,
    minIntervalMs: HOT_INTERVAL_MS,
  });
}

export async function pullAnalyticsCold(
  deps: AnalyticsDeps = {},
): Promise<AnalyticsResult> {
  return pullAnalytics({
    ...deps,
    minAgeMs: HOT_AGE_MS,
    maxAgeMs: COLD_AGE_MS,
    minIntervalMs: COLD_INTERVAL_MS,
  });
}

interface PullOpts extends AnalyticsDeps {
  minAgeMs: number;
  maxAgeMs: number;
  minIntervalMs: number;
}

async function pullAnalytics(opts: PullOpts): Promise<AnalyticsResult> {
  const db = opts.db ?? defaultDb;
  const getPub = opts.getPublisherFor ?? getPublisher;
  const now = opts.now ?? (() => new Date());
  const limit = opts.limit ?? 50;

  const ceilingPublishedAt = new Date(now().getTime() - opts.minAgeMs);
  const floorPublishedAt = new Date(now().getTime() - opts.maxAgeMs);
  const intervalCutoff = new Date(now().getTime() - opts.minIntervalMs);

  // Posts in the right age window, with an external id, due for a pull.
  // Drizzle's pg `lt`/`gte` are bound to columns; we use raw SQL for the
  // "last snapshot pulled_at < cutoff OR no snapshot" predicate.
  const candidates = await db
    .select({
      id: schema.posts.id,
      brandId: schema.posts.brandId,
      channel: schema.posts.channel,
      externalPostId: schema.posts.externalPostId,
    })
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.status, "published"),
        isNotNull(schema.posts.externalPostId),
        isNotNull(schema.posts.publishedAt),
        lt(schema.posts.publishedAt, ceilingPublishedAt),
        gte(schema.posts.publishedAt, floorPublishedAt),
        sql`(
          NOT EXISTS (
            SELECT 1 FROM analytics_snapshots s
             WHERE s.post_id = posts.id AND s."pulledAt" > ${intervalCutoff.toISOString()}
          )
        )`,
      ),
    )
    .limit(limit);

  let pulled = 0;
  let failed = 0;
  // Cache channel connections per (brandId, channel) so we don't re-query
  // for every post in the loop.
  const connCache = new Map<string, typeof schema.channelConnections.$inferSelect | null>();
  const loadConn = async (
    brandId: string,
    channel: "instagram" | "facebook",
  ) => {
    const k = `${brandId}:${channel}`;
    if (connCache.has(k)) return connCache.get(k) ?? null;
    const rows = await db
      .select()
      .from(schema.channelConnections)
      .where(
        and(
          eq(schema.channelConnections.brandId, brandId),
          eq(schema.channelConnections.channel, channel),
        ),
      )
      .limit(1);
    const row = rows[0] ?? null;
    connCache.set(k, row);
    return row;
  };

  for (const post of candidates) {
    if (post.channel !== "instagram" && post.channel !== "facebook") continue;
    if (!post.externalPostId) continue;
    try {
      const conn = await loadConn(post.brandId, post.channel);
      if (!conn || conn.status !== "connected") {
        failed++;
        // eslint-disable-next-line no-console
        console.error(
          `[analytics] post=${post.id} skipped: no connected channel_connection`,
        );
        continue;
      }
      const publisher = getPub(post.channel);
      const snap = await publisher.fetchAnalytics(post.externalPostId, {
        brand_id: conn.brandId,
        channel: conn.channel,
        external_account_id: conn.externalAccountId ?? "",
        access_token: conn.accessToken,
        refresh_token: conn.refreshToken,
        token_expires_at: conn.tokenExpiresAt?.toISOString() ?? null,
        status: conn.status,
        meta_json: conn.metaJson as Record<string, unknown>,
      });
      await insertSnapshot(db, post.id, post.brandId, snap);
      pulled++;
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(
        `[analytics] post=${post.id} failed: ${(err as Error).message}`,
      );
    }
  }

  // Daily brand-level metrics. Only the cold pull triggers this so we don't
  // hammer the API hourly with /me data.
  if (opts.minAgeMs > 0) {
    await refreshBrandMetrics(db, getPub, now);
  }

  return { pulled, failed };
}

async function insertSnapshot(
  db: DbOrTx,
  postId: string,
  brandId: string,
  snap: AnalyticsSnapshot,
): Promise<void> {
  await db.insert(schema.analyticsSnapshots).values({
    postId,
    brandId,
    reach: snap.reach ?? null,
    impressions: snap.impressions ?? null,
    likes: snap.likes ?? null,
    comments: snap.comments ?? null,
    shares: snap.shares ?? null,
    saves: snap.saves ?? null,
    watchTimeSec: snap.watch_time_sec ?? null,
    videoViews: snap.video_views ?? null,
    profileVisits: snap.profile_visits ?? null,
    followsFromPost: snap.follows_from_post ?? null,
    rawJson:
      (snap.raw_json as Record<string, unknown>) ??
      ({ payload: snap } as Record<string, unknown>),
  });
}

async function refreshBrandMetrics(
  db: DbOrTx,
  _getPub: NonNullable<AnalyticsDeps["getPublisherFor"]>,
  now: () => Date,
): Promise<void> {
  const oneDayAgo = new Date(now().getTime() - 24 * 60 * 60 * 1000);
  const connections = await db
    .select()
    .from(schema.channelConnections)
    .where(eq(schema.channelConnections.status, "connected"));

  for (const conn of connections) {
    if (conn.channel !== "instagram" && conn.channel !== "facebook") continue;
    // Has a row in the last 24h? skip.
    const recent = await db
      .select({ id: schema.brandMetricsSnapshots.id })
      .from(schema.brandMetricsSnapshots)
      .where(
        and(
          eq(schema.brandMetricsSnapshots.brandId, conn.brandId),
          eq(schema.brandMetricsSnapshots.channel, conn.channel),
          gte(schema.brandMetricsSnapshots.pulledAt, oneDayAgo),
        ),
      )
      .limit(1);
    if (recent[0]) continue;

    try {
      const accountId =
        conn.channel === "instagram"
          ? (conn.metaJson.igBusinessId ?? conn.externalAccountId)
          : (conn.metaJson.fbPageId ?? conn.externalAccountId);
      if (!accountId) continue;
      const metrics = await fetchAccountMetrics({
        channel: conn.channel,
        accountId,
        accessToken: conn.accessToken,
      });
      await db.insert(schema.brandMetricsSnapshots).values({
        brandId: conn.brandId,
        channel: conn.channel,
        followerCount: metrics.followerCount,
        followingCount: metrics.followingCount,
        totalPosts: metrics.totalPosts,
        rawJson: (metrics.raw ?? {}) as Record<string, unknown>,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[analytics] brand_metrics brand=${conn.brandId} ${conn.channel} failed: ${(err as Error).message}`,
      );
    }
  }
}

export const __internals = { desc };
