/**
 * The clip-upload steps, shared by the signed-in routes (app/api/conversations/[id]/uploads/...,
 * access from requireConversation) and the upload-link routes (app/api/u/[token]/uploads/..., access
 * from the link: lib/conversations/upload-link.ts). The caller has already proved access to the thread.
 *
 *   start    { filename, size, contentType } -> opens a multipart upload on R2 (`incoming/`), records the clip as `uploading`
 *   parts    { partNumbers }                 -> presigned PUT URLs (one hour), up to 50 at a time
 *   complete { parts: [{ partNumber, etag }] } -> finishes, checks the size, marks `processing` and sends it to the optimizer
 *   abort                                    -> cancels a clip still uploading
 *   done     { mediaIds }                    -> one "Added 3 clips" message, handed to the editor
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AccessError } from "@/lib/auth/workspace";
import type { ConversationAccess } from "@/lib/conversations/access";
import { handOffToEditor } from "@/lib/conversations/editor";
import { addMessage } from "@/lib/conversations/store";
import { db, schema } from "@/lib/db";
import { postEditorMessage } from "@/lib/editor/notify";
import { storageFullBody, storageRoom } from "@/lib/limits/storage";
import { requireConversationMedia } from "@/lib/media/access";
import { fail, jsonBody, threadClosed, withStorage } from "@/lib/media/http";
import { requestOptimize } from "@/lib/media/optimize";
import {
  clipsAddedMessage,
  formatBytes,
  isVideoFile,
  MAX_DONE_IDS,
  MAX_FILE_BYTES,
  MAX_PART_URLS_PER_CALL,
  MAX_PARTS,
  planParts,
  videoContentType,
} from "@/lib/media/rules";
import { markGone, markProcessing, threadMedia, toClipSummary } from "@/lib/media/store";
import { buildMediaKey, InvalidMediaKeyError } from "@/lib/storage/keys";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  deleteObject,
  headObject,
  presignUploadPart,
} from "@/lib/storage/r2";

const startSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().max(200).optional(),
});

/** Checks it is a video, at most 10 GB, and fits the workspace's storage. Answers { mediaId, partSize, partCount }. */
export async function startUpload(req: NextRequest, access: ConversationAccess): Promise<Response> {
  if (access.conversation.status !== "open") return threadClosed();
  const parsed = startSchema.safeParse(await jsonBody(req));
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
}

const partsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(MAX_PARTS)).min(1).max(MAX_PART_URLS_PER_CALL),
});

/** Presigned PUT URLs (one hour) for up to 50 parts of a clip still uploading. */
export async function partUrls(req: NextRequest, access: ConversationAccess, mediaId: string): Promise<Response> {
  const media = await requireConversationMedia(access, mediaId);
  if (access.conversation.status !== "open") return threadClosed();
  if (media.status !== "uploading" || !media.uploadId) return fail(409, "not_uploading", "This clip is not uploading any more.");
  const parsed = partsSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return fail(400, "invalid", `Ask for 1 to ${MAX_PART_URLS_PER_CALL} part numbers.`);
  const { partCount } = planParts(media.sizeBytes);
  const numbers = [...new Set(parsed.data.partNumbers)];
  if (numbers.some((n) => n > partCount)) return fail(400, "invalid", `This clip has ${partCount} parts.`);
  const uploadId = media.uploadId;
  return withStorage(async () =>
    NextResponse.json({ urls: numbers.map((partNumber) => ({ partNumber, url: presignUploadPart(media.r2Key, uploadId, partNumber) })) }),
  );
}

const completeSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(MAX_PARTS), etag: z.string().trim().min(1).max(200) }))
    .min(1)
    .max(MAX_PARTS),
});

/**
 * Finishes one clip's multipart upload and checks the stored size against the declared one. A match
 * marks it `processing` and sends it to the optimizer (`ready` straight away without one); a
 * mismatch removes the object and marks the clip failed.
 */
export async function completeUpload(req: NextRequest, access: ConversationAccess, mediaId: string): Promise<Response> {
  const media = await requireConversationMedia(access, mediaId);
  if (media.status === "ready" || media.status === "processing") return NextResponse.json({ clip: toClipSummary(media) }); // a retried call
  if (access.conversation.status !== "open") return threadClosed();
  if (media.status !== "uploading" || !media.uploadId) return fail(409, "not_uploading", "This clip is not uploading any more.");
  const parsed = completeSchema.safeParse(await jsonBody(req));
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
    const processing = await markProcessing(media);
    const now = (await requestOptimize(processing.id, req.nextUrl.origin)) ?? processing;
    return NextResponse.json({ clip: toClipSummary(now) });
  });
}

/** Cancels a clip still uploading: aborts the multipart upload and marks it failed. */
export async function abortUpload(access: ConversationAccess, mediaId: string): Promise<Response> {
  const media = await requireConversationMedia(access, mediaId);
  if (media.status === "ready") return fail(409, "already_uploaded", "This clip has finished uploading.");
  return withStorage(async () => {
    if (media.uploadId) await abortMultipartUpload(media.r2Key, media.uploadId);
    await markGone(media);
    return NextResponse.json({ ok: true });
  });
}

const doneSchema = z.object({ mediaIds: z.array(z.string().uuid()).min(1).max(MAX_DONE_IDS) });

/**
 * After a batch: one message in the thread ("Added 3 clips (1.2 GB)"), handed to the editor; its
 * answer, if any, is posted after it (and texted, when the thread is running by text). Every id must
 * be a clip of this thread (else 404); only finished ones count, at their uploaded size.
 */
export async function uploadsDone(req: NextRequest, access: ConversationAccess): Promise<Response> {
  if (access.conversation.status !== "open") return threadClosed();
  const parsed = doneSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return fail(400, "invalid", "Send the ids of the clips that finished.");
  const ids = [...new Set(parsed.data.mediaIds.map((m) => m.toLowerCase()))];
  const rows = await threadMedia(access.conversation.id, access.workspaceId, ids);
  if (rows.length !== ids.length) throw new AccessError(404, "Not found.");
  const clips = rows.filter((m) => (m.status === "ready" || m.status === "processing") && !m.deletedAt);
  if (clips.length === 0) return fail(400, "no_clips", "None of those clips finished uploading.");

  const total = clips.reduce((sum, c) => sum + (c.originalSizeBytes ?? c.sizeBytes), 0);
  const message = await addMessage({
    conversationId: access.conversation.id,
    direction: "out",
    channel: "app",
    body: clipsAddedMessage(clips.length, total),
  });
  const { queued, reply } = await handOffToEditor(access.conversation.id, message.id, req.nextUrl.origin);
  if (reply) await postEditorMessage(access.conversation, reply);
  return NextResponse.json({ messageId: message.id, count: clips.length, totalBytes: total, editor: { queued } });
}
