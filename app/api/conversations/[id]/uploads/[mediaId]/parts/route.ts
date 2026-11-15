/**
 * POST /api/conversations/[id]/uploads/[mediaId]/parts { partNumbers } — presigned PUT URLs (one
 * hour) for up to 50 parts of a clip that is still uploading. The browser PUTs each part straight
 * to R2 and keeps the ETag it gets back.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { requireConversationMedia } from "@/lib/media/access";
import { fail, jsonBody, threadClosed, withStorage } from "@/lib/media/http";
import { MAX_PART_URLS_PER_CALL, MAX_PARTS, planParts } from "@/lib/media/rules";
import { presignUploadPart } from "@/lib/storage/r2";

export const runtime = "nodejs";

const bodySchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(MAX_PARTS)).min(1).max(MAX_PART_URLS_PER_CALL),
});

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string; mediaId: string }> }): Promise<Response> => {
  const { id, mediaId } = await ctx.params;
  const access = await requireConversation(id);
  const media = await requireConversationMedia(access, mediaId);
  if (access.conversation.status !== "open") return threadClosed();
  if (media.status !== "uploading" || !media.uploadId) return fail(409, "not_uploading", "This clip is not uploading any more.");
  const parsed = bodySchema.safeParse(await jsonBody(req));
  if (!parsed.success) return fail(400, "invalid", `Ask for 1 to ${MAX_PART_URLS_PER_CALL} part numbers.`);
  const { partCount } = planParts(media.sizeBytes);
  const numbers = [...new Set(parsed.data.partNumbers)];
  if (numbers.some((n) => n > partCount)) return fail(400, "invalid", `This clip has ${partCount} parts.`);
  const uploadId = media.uploadId;
  return withStorage(async () =>
    NextResponse.json({ urls: numbers.map((partNumber) => ({ partNumber, url: presignUploadPart(media.r2Key, uploadId, partNumber) })) }),
  );
});
