/**
 * GET /api/media/[mediaId] — a 302 to a short-lived (10 minute) signed link for a ready media
 * object (or one being optimized: until then it plays as uploaded). Ownership is checked through the object's own workspace (requireMedia); the bucket is
 * private, so this is the only way to read a file.
 */
import { NextResponse, type NextRequest } from "next/server";
import { guard } from "@/lib/auth/workspace";
import { requireMedia } from "@/lib/media/access";
import { fail, withStorage } from "@/lib/media/http";
import { presignGet } from "@/lib/storage/r2";

export const runtime = "nodejs";

export const GET = guard(async (_req: NextRequest, ctx: { params: Promise<{ mediaId: string }> }): Promise<Response> => {
  const { mediaId } = await ctx.params;
  const { media } = await requireMedia(mediaId);
  if (media.status !== "ready" && media.status !== "processing") return fail(409, "not_ready", "This file has not finished uploading.");
  return withStorage(async () => {
    const res = NextResponse.redirect(presignGet(media.r2Key), 302);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  });
});
