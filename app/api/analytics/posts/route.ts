/**
 * GET /api/analytics/posts
 *
 * Returns the sortable post-table data: thumbnail, channel, format, title,
 * published date, reach, ER, saves, follower delta (best-effort).
 *
 * The table sorts client-side (URL-bound) over the returned rows.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  assets,
  briefs,
  draftAssets,
  drafts,
  posts,
} from "@/lib/db/schema";
import { parseFilters, resolveRange } from "@/lib/analytics/filters";
import { engagementOf, filterRows } from "@/lib/analytics/aggregate";
import {
  loadEnabledChannels,
  loadPostAggRows,
} from "@/lib/analytics/queries";

export const runtime = "nodejs";

const querySchema = z.object({ brandId: z.string().uuid() });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({ brandId: sp.get("brandId") });
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "invalid_query" } },
      { status: 400 },
    );
  }
  const { brandId } = parsed.data;
  const filters = parseFilters(sp);
  const { start, end } = resolveRange(filters);

  try {
    const enabledChannels = await loadEnabledChannels(brandId);
    const rows = await loadPostAggRows(brandId, start, end, enabledChannels);
    const filtered = filterRows(rows, filters, { start, end });

    // Enrich with title (from brief) + thumbnail (from primary draft_asset).
    const postIds = filtered.map((r) => r.postId);
    if (postIds.length === 0) {
      return NextResponse.json({ data: { posts: [] }, error: null });
    }

    // Fetch brief title + caption + primary asset thumb per post.
    const metaRows = await db
      .select({
        postId: posts.id,
        briefTitle: briefs.title,
        caption: drafts.caption,
        thumbnailUrl: assets.thumbnailUrl,
        storageUrl: assets.storageUrl,
      })
      .from(posts)
      .innerJoin(drafts, eq(drafts.id, posts.draftId))
      .innerJoin(briefs, eq(briefs.id, drafts.briefId))
      .leftJoin(draftAssets, and(
        eq(draftAssets.draftId, drafts.id),
        eq(draftAssets.role, "primary"),
      ))
      .leftJoin(assets, eq(assets.id, draftAssets.assetId))
      .where(inArray(posts.id, postIds));

    const metaById = new Map<string, (typeof metaRows)[number]>();
    metaRows.forEach((m) => {
      // First row wins per post (the joined draft_asset table may have many).
      if (!metaById.has(m.postId)) metaById.set(m.postId, m);
    });

    const enriched = filtered.map((r) => {
      const m = metaById.get(r.postId);
      const er = engagementOf(r);
      return {
        postId: r.postId,
        channel: r.channel,
        format: r.format,
        title:
          (m?.briefTitle && m.briefTitle.length > 0
            ? m.briefTitle
            : (m?.caption ?? "").slice(0, 60)) || "(untitled)",
        publishedAt: r.publishedAt,
        thumbnailUrl: m?.thumbnailUrl ?? m?.storageUrl ?? null,
        reach: r.reach,
        views: r.impressions,
        likes: r.likes,
        engagementRate: er.rate,
        saves: r.saves,
        followsFromPost: r.followsFromPost,
      };
    });

    return NextResponse.json({ data: { posts: enriched }, error: null });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { code: "query_failed", message: (err as Error).message } },
      { status: 500 },
    );
  }
}

