/**
 * POST /api/conversations/[id]/uploads/[mediaId]/complete { parts: [{ partNumber, etag }] } —
 * finishes one clip's multipart upload, then checks the stored object's size against the size
 * declared at the start. A match marks the clip `ready`; a mismatch removes the object and marks the
 * clip failed. The thread message for a batch comes from ../../done, not from here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { requireConversationMedia } from "@/lib/media/access";
import { fail, jsonBody, threadClosed, withStorage } from "@/lib/media/http";
import { MAX_PARTS, planParts } from "@/lib/media/rules";
import { markGone, markReady, toClipSummary } from "@/lib/media/store";
import { completeMultipartUpload, deleteObject, headObject } from "@/lib/storage/r2";

export const runtime = "nodejs";

const bodySchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(MAX_PARTS), etag: z.string().trim().min(1).max(200) }))
    .min(1)
    .max(MAX_PARTS),
});

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string; mediaId: string }> }): Promise<Response> => {
  const { id, mediaId } = await ctx.params;
  const access = await requireConversation(id);
  const media = await requireConversationMedia(access, mediaId);
  if (media.status === "ready") return NextResponse.json({ clip: toClipSummary(media) }); // completed already (a retried call)
  if (access.conversation.status !== "open") return threadClosed();
  if (media.status !== "uploading" || !media.uploadId) return fail(409, "not_uploading", "This clip is not uploading any more.");
  const parsed = bodySchema.safeParse(await jsonBody(req));
  if (!parsed.success) return fail(400, "invalid", "Send every part's number and ETag.");

  const { partCount } = planParts(media.sizeBytes);
  const parts = [...parsed.data.parts].sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== partCount || parts.some((p, i) => p.partNumber !== i + 1)) {
    return fail(400, "missing_parts", `Expected parts 1 to ${partCount}, each once.`);
  }
  const uploadId = media.uploadId;

  return withStorage(async () => {
    await completeMultipartUpload(media.r2Key, uploadId, parts);
    const head = await headObject(media.r2Key);
    if (!head || head.size !== media.sizeBytes) {
      if (head) await deleteObject(media.r2Key).catch(() => undefined);
      await markGone(media);
      return fail(422, "size_mismatch", `${media.filename} did not arrive complete. Please add it again.`, { clip: { ...toClipSummary(media), status: "failed" } });
    }
    const ready = await markReady(media);
    return NextResponse.json({ clip: toClipSummary(ready) });
  });
});
