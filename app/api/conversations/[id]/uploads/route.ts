/**
 * POST /api/conversations/[id]/uploads { filename, size, contentType } — start uploading one clip
 * into an open thread. Checks it is a video, at most 10 GB, and fits the workspace's storage; then
 * opens a multipart upload on R2, in the holding area (`incoming/`, see lib/media/optimize.ts), and
 * records the clip as `uploading`.
 * Answers { mediaId, partSize, partCount }; the browser then asks for part URLs (./[mediaId]/parts).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/auth/workspace";
import { requireConversation } from "@/lib/conversations/access";
import { db, schema } from "@/lib/db";
import { storageFullBody, storageRoom } from "@/lib/limits/storage";
import { fail, jsonBody, threadClosed, withStorage } from "@/lib/media/http";
import { formatBytes, isVideoFile, MAX_FILE_BYTES, planParts, videoContentType } from "@/lib/media/rules";
import { buildMediaKey, InvalidMediaKeyError } from "@/lib/storage/keys";
import { abortMultipartUpload, createMultipartUpload } from "@/lib/storage/r2";

export const runtime = "nodejs";

const bodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().max(200).optional(),
});

export const POST = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await ctx.params;
  const access = await requireConversation(id);
  if (access.conversation.status !== "open") return threadClosed();
  const parsed = bodySchema.safeParse(await jsonBody(req));
  if (!parsed.success) return fail(400, "invalid", "Send the file's name, size and type.");
  const { filename, size } = parsed.data;

  if (!isVideoFile(filename, parsed.data.contentType)) return fail(415, "not_video", `${filename} is not a video. Add .mov, .mp4 or .m4v clips.`);
  if (size > MAX_FILE_BYTES) return fail(413, "file_too_large", `${filename} is ${formatBytes(size)}. Clips can be up to ${formatBytes(MAX_FILE_BYTES)} each.`);
  const room = await storageRoom(access.workspaceId);
  if (room.usedBytes + size > room.limitBytes) {
    const left = Math.max(0, room.limitBytes - room.usedBytes);
    return NextResponse.json(
      { ...storageFullBody(room), message: `${filename} is ${formatBytes(size)}, and this workspace has ${formatBytes(left)} of storage left.` },
      { status: 413 },
    );
  }

  const mediaId = randomUUID();
  let key: string;
  try {
    key = buildMediaKey({ workspaceId: access.workspaceId, conversationId: access.conversation.id, filename, id: mediaId, kind: "incoming" });
  } catch (err) {
    if (err instanceof InvalidMediaKeyError) return fail(400, "invalid_filename", err.message);
    throw err;
  }
  const contentType = videoContentType(filename, parsed.data.contentType);
  const { partSize, partCount } = planParts(size);

  return withStorage(async () => {
    const uploadId = await createMultipartUpload(key, contentType);
    try {
      await db.insert(schema.mediaObjects).values({
        id: mediaId,
        workspaceId: access.workspaceId,
        brandId: access.conversation.brandId,
        conversationId: access.conversation.id,
        kind: "raw",
        r2Key: key,
        filename,
        contentType,
        sizeBytes: size,
        status: "uploading",
        uploadId,
        uploadedBy: access.user.userId,
      });
    } catch (err) {
      await abortMultipartUpload(key, uploadId).catch(() => undefined);
      throw err;
    }
    return NextResponse.json({ mediaId, partSize, partCount });
  });
});
