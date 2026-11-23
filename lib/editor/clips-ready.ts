/**
 * A clip can still be `processing` (waiting for the optimizer to take it) when the "Added N clips"
 * message is stored, and that hand-off then holds off. This is the other trigger: when a thread's
 * last clip becomes ready, start the same first cut, once, provided the batch has been sent. Two callbacks landing together both reach the insert; the one-active-job unique index
 * lets one through and the other is treated as "already started" (nothing is posted for it).
 */
import { and, desc, eq, gt, inArray, isNull, like } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hasAnyJob } from "./jobs";
import { postEditorMessage } from "./notify";
import { startEditorJob } from "./submit";

const { conversations, conversationMessages, mediaObjects } = schema;

export async function startFirstCutIfClipsReady(conversationId: string | null): Promise<boolean> {
  if (!conversationId) return false;
  try {
    const [thread] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!thread || thread.status !== "open" || !thread.kind || !thread.brandId) return false;
    const [pending] = await db
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.conversationId, thread.id),
          eq(mediaObjects.kind, "raw"),
          inArray(mediaObjects.status, ["uploading", "processing"]),
          isNull(mediaObjects.deletedAt),
        ),
      )
      .limit(1);
    if (pending || (await hasAnyJob(thread.id))) return false;
    // Only once the person has sent the batch: its own message ("Added N clips"), with no clip added since.
    // Clips are ready the moment they finish uploading, long before Send on an upload link.
    const [trigger] = await db
      .select({ id: conversationMessages.id, createdAt: conversationMessages.createdAt })
      .from(conversationMessages)
      .where(and(eq(conversationMessages.conversationId, thread.id), like(conversationMessages.body, "Added %")))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(1);
    if (!trigger) return false;
    const [unsent] = await db
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(and(eq(mediaObjects.conversationId, thread.id), eq(mediaObjects.kind, "raw"), isNull(mediaObjects.deletedAt), gt(mediaObjects.createdAt, trigger.createdAt)))
      .limit(1);
    if (unsent) return false;
    const handoff = await startEditorJob(thread.id, trigger.id);
    // "busy" means another callback started it a moment ago: already started, say nothing.
    if (handoff.reason === "busy") return false;
    if (handoff.reply) await postEditorMessage(thread, handoff.reply);
    return handoff.queued;
  } catch (err) {
    // Never let the editor break the optimizer's callback: the clip is ready either way.
    console.warn(`[editor] could not start a first cut after clips became ready: ${(err as Error).message}`);
    return false;
  }
}
