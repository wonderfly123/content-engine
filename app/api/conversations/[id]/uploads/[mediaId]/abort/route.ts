/**
 * POST /api/conversations/[id]/uploads/[mediaId]/abort — cancel a clip that is still uploading:
 * aborts the multipart upload on R2 (its parts are discarded) and marks the clip failed. A clip that
 * finished uploading cannot be aborted.
 */
import { NextResponse, type NextRequest } from "next/server";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { requireConversationMedia } from "@/lib/media/access";
import { fail, withStorage } from "@/lib/media/http";
import { markGone } from "@/lib/media/store";
import { abortMultipartUpload } from "@/lib/storage/r2";

export const runtime = "nodejs";

export const POST = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string; mediaId: string }> }): Promise<Response> => {
  const { id, mediaId } = await ctx.params;
  const access = await requireConversation(id);
  const media = await requireConversationMedia(access, mediaId);
  if (media.status === "ready") return fail(409, "already_uploaded", "This clip has finished uploading.");
  return withStorage(async () => {
    if (media.uploadId) await abortMultipartUpload(media.r2Key, media.uploadId);
    await markGone(media);
    return NextResponse.json({ ok: true });
  });
});
