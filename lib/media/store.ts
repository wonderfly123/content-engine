/**
 * Reading and writing media rows. No access checks here: callers have already proved who is asking
 * (requireConversation / requireConversationMedia / requireMedia), and every query is scoped by the
 * workspace and conversation that check returned.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { MediaStatus } from "@/lib/db/enums";
import type { MediaRow } from "./access";

const { mediaObjects } = schema;

export interface ClipSummary {
  id: string;
  filename: string;
  sizeBytes: number;
  /** Size as uploaded, when the optimizer has since shrunk it (else null). */
  originalSizeBytes: number | null;
  contentType: string;
  status: MediaStatus;
  createdAt: Date;
}

/** A thread's raw clips that still exist, oldest first. */
export async function listClips(conversationId: string, workspaceId: string): Promise<ClipSummary[]> {
  return db
    .select({
      id: mediaObjects.id,
      filename: mediaObjects.filename,
      sizeBytes: mediaObjects.sizeBytes,
      originalSizeBytes: mediaObjects.originalSizeBytes,
      contentType: mediaObjects.contentType,
      status: mediaObjects.status,
      createdAt: mediaObjects.createdAt,
    })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.conversationId, conversationId),
        eq(mediaObjects.workspaceId, workspaceId),
        eq(mediaObjects.kind, "raw"),
        isNull(mediaObjects.deletedAt),
      ),
    )
    .orderBy(asc(mediaObjects.createdAt));
}

/** This thread's media rows among the given ids, in any state (callers check which are ready). */
export async function threadMedia(conversationId: string, workspaceId: string, ids: string[]): Promise<MediaRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(mediaObjects)
    .where(and(inArray(mediaObjects.id, ids), eq(mediaObjects.conversationId, conversationId), eq(mediaObjects.workspaceId, workspaceId)));
}

/** Uploaded and checked: waiting for the optimizer (lib/media/optimize.ts), counted at its uploaded size. */
export async function markProcessing(media: MediaRow): Promise<MediaRow> {
  const [row] = await db
    .update(mediaObjects)
    .set({ status: "processing", uploadId: null, originalSizeBytes: media.sizeBytes, optimizeError: null, updatedAt: new Date() })
    .where(and(eq(mediaObjects.id, media.id), eq(mediaObjects.workspaceId, media.workspaceId)))
    .returning();
  return row;
}

/** Failed or cancelled: nothing is stored any more, so it no longer counts against storage. */
export async function markGone(media: MediaRow): Promise<void> {
  const now = new Date();
  await db
    .update(mediaObjects)
    .set({ status: "failed", uploadId: null, deletedAt: now, updatedAt: now })
    .where(and(eq(mediaObjects.id, media.id), eq(mediaObjects.workspaceId, media.workspaceId)));
}

export const toClipSummary = (m: MediaRow): ClipSummary => ({
  id: m.id,
  filename: m.filename,
  sizeBytes: m.sizeBytes,
  originalSizeBytes: m.originalSizeBytes,
  contentType: m.contentType,
  status: m.status,
  createdAt: m.createdAt,
});
