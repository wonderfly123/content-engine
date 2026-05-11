import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { generateThumbnail } from "@/lib/assets/thumbnail";

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
export async function GET(
  _req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const [row] = await db.select().from(assets).where(eq(assets.id, id));
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
      .where(eq(assets.id, id));
  }
  return NextResponse.json({
    url: thumb.url,
    cached: false,
    note: thumb.note,
  });
}
