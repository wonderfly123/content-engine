/**
 * With the optimizer on, clips are still `processing` when the "Added N clips" message is stored,
 * so that hand-off finds nothing ready. This is the other trigger: when a thread's last clip
 * becomes ready (optimized, kept as uploaded, or given up on by the sweep), start the same first
 * cut, once. Two callbacks landing together both reach the insert; the one-active-job unique index
 * lets one through and the other is treated as "already started" (nothing is posted for it).
 */
import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
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
    // The clips' own message ("Added N clips") when there is one; else the thread's latest message.
    const latest = (where: SQL | undefined) =>
      db.select({ id: conversationMessages.id }).from(conversationMessages).where(where).orderBy(desc(conversationMessages.createdAt)).limit(1);
    const [trigger] = await latest(and(eq(conversationMessages.conversationId, thread.id), eq(conversationMessages.direction, "out")));
    const [fallback] = trigger ? [trigger] : await latest(eq(conversationMessages.conversationId, thread.id));
    if (!fallback) return false;
    const handoff = await startEditorJob(thread.id, fallback.id);
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
