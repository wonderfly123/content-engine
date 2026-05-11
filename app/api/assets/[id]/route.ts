import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, draftAssets, drafts } from "@/lib/db/schema";
import { updateAssetRequestSchema } from "@/lib/assets/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const [row] = await db.select().from(assets).where(eq(assets.id, id));
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const usedBy = await db
    .select({
      draftId: draftAssets.draftId,
      channel: drafts.channel,
      format: drafts.format,
      slotIndex: draftAssets.slotIndex,
      role: draftAssets.role,
    })
    .from(draftAssets)
    .innerJoin(drafts, eq(drafts.id, draftAssets.draftId))
    .where(eq(draftAssets.assetId, id));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(draftAssets)
    .where(eq(draftAssets.assetId, id));

  return NextResponse.json({
    asset: { ...row, usageCount: Number(count) },
    usedBy,
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = updateAssetRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const patch = parsed.data;
  const update: Partial<typeof assets.$inferInsert> = {};
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.tags !== undefined) update.tags = patch.tags;
  if (patch.archived !== undefined) update.archived = patch.archived;
  if (patch.notes !== undefined) update.notes = patch.notes;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const [row] = await db
    .update(assets)
    .set(update)
    .where(eq(assets.id, id))
    .returning();
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ asset: row });
}

/**
 * DELETE — soft-archive only. Real deletion happens (if ever) via an admin
 * sweep, because `draft_assets.asset_id` uses `ON DELETE RESTRICT`.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const [row] = await db
    .update(assets)
    .set({ archived: true })
    .where(eq(assets.id, id))
    .returning();
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ asset: row });
}
