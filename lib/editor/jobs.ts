/**
 * Reading and moving editor jobs. No access checks here: callers have already proved who is asking
 * (requireConversation in the app, a confirmed phone for texts, the worker's secret for callbacks),
 * and every query is scoped by the conversation (and workspace) that check returned.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { EditorJobStatus } from "@/lib/db/enums";
import { postEditorMessage } from "./notify";

const { editorJobs, conversations } = schema;

export type EditorJobRow = typeof editorJobs.$inferSelect;

/** A job queued or running for longer than this is given up on. */
export const EDITOR_STUCK_AFTER_MS = 65 * 60 * 1000;
export const STUCK_MESSAGE = "This edit took too long and was stopped. Send your request again to retry.";

export async function getJob(id: string): Promise<EditorJobRow | null> {
  const [row] = await db.select().from(editorJobs).where(eq(editorJobs.id, id)).limit(1);
  return row ?? null;
}

/** The thread's job that is queued or running, if any (there is at most one). */
export async function activeJob(conversationId: string): Promise<EditorJobRow | null> {
  const [row] = await db
    .select()
    .from(editorJobs)
    .where(and(eq(editorJobs.conversationId, conversationId), inArray(editorJobs.status, ["queued", "running"])))
    .limit(1);
  return row ?? null;
}

/** The newest job with cuts (done or approved): a revision starts from its manifest. */
export async function latestFinishedJob(conversationId: string): Promise<EditorJobRow | null> {
  const [row] = await db
    .select()
    .from(editorJobs)
    .where(and(eq(editorJobs.conversationId, conversationId), inArray(editorJobs.status, ["done", "approved"]), isNotNull(editorJobs.manifest)))
    .orderBy(desc(editorJobs.createdAt))
    .limit(1);
  return row ?? null;
}

export async function hasAnyJob(conversationId: string): Promise<boolean> {
  const [row] = await db.select({ id: editorJobs.id }).from(editorJobs).where(eq(editorJobs.conversationId, conversationId)).limit(1);
  return Boolean(row);
}

export async function jobsForThread(conversationId: string, workspaceId: string): Promise<EditorJobRow[]> {
  return db
    .select()
    .from(editorJobs)
    .where(and(eq(editorJobs.conversationId, conversationId), eq(editorJobs.workspaceId, workspaceId)))
    .orderBy(desc(editorJobs.createdAt));
}

/** Moves a job to `failed`, only from one of the given states. Returns the row, or null when it had already moved on. */
export async function failJob(id: string, error: string, from: EditorJobStatus[] = ["queued", "running"]): Promise<EditorJobRow | null> {
  const now = new Date();
  const [row] = await db
    .update(editorJobs)
    .set({ status: "failed", error: error.slice(0, 2000), finishedAt: now, updatedAt: now })
    .where(and(eq(editorJobs.id, id), inArray(editorJobs.status, from)))
    .returning();
  return row ?? null;
}

/** "yes" / Approve: the thread's latest job with cuts becomes `approved`, if it is not already. Scheduling it is a later stage. */
export async function approveLatestDone(conversationId: string): Promise<EditorJobRow | null> {
  const [latest] = await db
    .select({ id: editorJobs.id })
    .from(editorJobs)
    .where(and(eq(editorJobs.conversationId, conversationId), inArray(editorJobs.status, ["done", "approved"]), isNotNull(editorJobs.manifest)))
    .orderBy(desc(editorJobs.createdAt))
    .limit(1);
  // Only the newest cuts can be approved (a question with no cuts has nothing to approve).
  if (!latest) return null;
  const now = new Date();
  const [row] = await db
    .update(editorJobs)
    .set({ status: "approved", approvedAt: now, updatedAt: now })
    .where(and(eq(editorJobs.id, latest.id), eq(editorJobs.status, "done")))
    .returning();
  return row ?? null;
}

/**
 * Jobs queued or running for longer than EDITOR_STUCK_AFTER_MS become `failed`, with a message in their thread. Runs
 * hourly with the optimizer's sweep (the connections cron), and for one thread whenever that thread
 * is opened or messaged, so nobody waits on a job that is gone.
 */
export async function recoverStuckEditorJobs(now: Date = new Date(), conversationId?: string): Promise<number> {
  const cutoff = new Date(now.getTime() - EDITOR_STUCK_AFTER_MS);
  const rows = await db
    .update(editorJobs)
    .set({ status: "failed", error: `No result within ${EDITOR_STUCK_AFTER_MS / 60_000} minutes.`, finishedAt: now, updatedAt: now })
    .where(
      and(
        inArray(editorJobs.status, ["queued", "running"]),
        or(lt(editorJobs.startedAt, cutoff), and(isNull(editorJobs.startedAt), lt(editorJobs.createdAt, cutoff))),
        ...(conversationId ? [eq(editorJobs.conversationId, conversationId)] : []),
      ),
    )
    .returning();
  for (const job of rows) {
    const [thread] = await db.select().from(conversations).where(eq(conversations.id, job.conversationId)).limit(1);
    if (thread) await postEditorMessage(thread, STUCK_MESSAGE);
  }
  return rows.length;
}
