/**
 * GET /api/analytics/post/[id]
 *
 * Returns everything the drill-down page needs in one round-trip:
 *   - post + draft + brief
 *   - asset list (in slot order)
 *   - all analytics_snapshots for the post (for retention chart + history)
 *   - provenance trail: events rows scoped to the chain
 *     (brief.id → draft.id → post.id, plus brand and any asset ids).
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, requireOwned } from "@/lib/auth/workspace";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  analyticsSnapshots,
  assets,
  briefs,
  draftAssets,
  drafts,
  events,
  icps,
  posts,
} from "@/lib/db/schema";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = guard(async (_req: NextRequest, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const { brandId } = await requireOwned(posts, id);

  const postRows = await db
    .select({
      post: posts,
      draft: drafts,
      brief: briefs,
    })
    .from(posts)
    .innerJoin(drafts, eq(drafts.id, posts.draftId))
    .innerJoin(briefs, eq(briefs.id, drafts.briefId))
    .where(and(eq(posts.id, id), eq(posts.brandId, brandId)))
    .limit(1);

  const head = postRows[0];
  if (!head) {
    return NextResponse.json(
      { data: null, error: { code: "not_found" } },
      { status: 404 },
    );
  }

  // ICP (nullable on brief).
  const icpRows = head.brief.icpId
    ? await db.select().from(icps).where(and(eq(icps.id, head.brief.icpId), eq(icps.brandId, brandId))).limit(1)
    : [];

  // Snapshots oldest → newest so the retention chart renders left → right.
  const snapshots = await db
    .select()
    .from(analyticsSnapshots)
    .where(and(eq(analyticsSnapshots.postId, id), eq(analyticsSnapshots.brandId, brandId)))
    .orderBy(asc(analyticsSnapshots.pulledAt));

  // Assets attached to the draft, in slot order.
  const attached = await db
    .select({
      slotIndex: draftAssets.slotIndex,
      role: draftAssets.role,
      asset: assets,
    })
    .from(draftAssets)
    .innerJoin(assets, eq(assets.id, draftAssets.assetId))
    .where(and(eq(draftAssets.draftId, head.draft.id), eq(assets.brandId, brandId)))
    .orderBy(asc(draftAssets.slotIndex));

  // Provenance trail: events rows for the chain.
  const chainIds = [head.brief.id, head.draft.id, head.post.id];
  attached.forEach((a) => chainIds.push(a.asset.id));
  const trail = await db
    .select()
    .from(events)
    .where(and(inArray(events.entityId, chainIds), eq(events.brandId, brandId)))
    .orderBy(asc(events.at));

  return NextResponse.json({
    data: {
      post: head.post,
      draft: head.draft,
      brief: head.brief,
      icp: icpRows[0] ?? null,
      assets: attached,
      snapshots,
      provenance: trail,
    },
    error: null,
  });
});
