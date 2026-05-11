/**
 * Server-only data loaders for the analytics endpoints. Centralised here so
 * all four endpoints (topline, trends, posts, post/[id]) share the same join
 * shape and there is no N+1.
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  analyticsSnapshots,
  brandMetricsSnapshots,
  briefs,
  drafts,
  posts,
} from "@/lib/db/schema";
import type { PostAggRow } from "./aggregate";

/**
 * Returns one row per published post in [from, to] with that post's latest
 * analytics snapshot stitched in. Filtering by channel/format/icp is done
 * in JS via `filterRows` — the SQL stays simple and cacheable.
 */
export async function loadPostAggRows(
  brandId: string,
  from: Date,
  to: Date,
): Promise<PostAggRow[]> {
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
  }));
}

export async function loadFollowerSeries(
  brandId: string,
  from: Date,
  to: Date,
): Promise<Array<{ pulledAt: Date; followerCount: number | null }>> {
  return db
    .select({
      pulledAt: brandMetricsSnapshots.pulledAt,
      followerCount: brandMetricsSnapshots.followerCount,
    })
    .from(brandMetricsSnapshots)
    .where(
      and(
        eq(brandMetricsSnapshots.brandId, brandId),
        gte(brandMetricsSnapshots.pulledAt, from),
        lte(brandMetricsSnapshots.pulledAt, to),
      ),
    )
    .orderBy(brandMetricsSnapshots.pulledAt);
}
