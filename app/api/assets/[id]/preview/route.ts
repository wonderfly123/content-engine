import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { generateThumbnail } from "@/lib/assets/thumbnail";
import { guard, requireOwned } from "@/lib/auth/workspace";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/assets/[id]/preview
 *
 * Returns a thumbnail URL. If we already have one cached on the row, return
 * it. Otherwise, generate one (image only — see thumbnail.ts for the video
 * caveat) and persist back to the row.
 */
export const GET = guard(async (
  _req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> => {
  const { id } = await ctx.params;
  const { brandId } = await requireOwned(assets, id);
  const owned = and(eq(assets.id, id), eq(assets.brandId, brandId));
  const [row] = await db.select().from(assets).where(owned);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.thumbnailUrl) {
    return NextResponse.json({ url: row.thumbnailUrl, cached: true });
  }
  const thumb = await generateThumbnail(row.storageUrl, row.kind);
  if (thumb.url) {
    await db
      .update(assets)
      .set({ thumbnailUrl: thumb.url })
      .where(owned);
  }
  return NextResponse.json({
    url: thumb.url,
    cached: false,
    note: thumb.note,
  });
});
