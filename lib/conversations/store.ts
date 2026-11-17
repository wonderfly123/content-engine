/**
 * Reading and writing threads and their messages. No access checks here: callers have already
 * proved who is asking (`requireConversation` / `requireBrand` in the app, a confirmed phone number
 * for texts). Every query is scoped by the workspace the caller was checked against.
 */
import { and, asc, desc, eq, gt, inArray, isNull, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ConversationKind, MessageChannel, MessageDirection } from "@/lib/db/enums";
import { BRAND_QUESTION_PREFIX, type BrandRef } from "./router";

const { conversations, conversationMessages, brands } = schema;

/** The database, or a transaction on it. */
export type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof conversationMessages.$inferSelect;

export type CloseReason = "new_thread" | "published" | "brand_texting_off";

/** The workspace's active brands, for "use the only one" and "Which brand?". */
export async function activeBrands(workspaceId: string, exec: Exec = db): Promise<BrandRef[]> {
  return exec
    .select({ id: brands.id, name: brands.name, slug: brands.slug })
    .from(brands)
    .where(and(eq(brands.workspaceId, workspaceId), eq(brands.status, "active")))
    .orderBy(asc(brands.name));
}

export async function findOpenThread(workspaceId: string, userId: string, exec: Exec = db): Promise<ConversationRow | null> {
  const [row] = await exec
    .select()
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.startedBy, userId), eq(conversations.status, "open")))
    .limit(1);
  return row ?? null;
}

/** One thread, only if it belongs to the given workspace. */
export async function getThread(id: string, workspaceId: string, exec: Exec = db): Promise<ConversationRow | null> {
  const [row] = await exec
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export interface NewThread {
  workspaceId: string;
  userId: string;
  startedVia: MessageChannel;
  kind: ConversationKind | null;
  brandId: string | null;
}

export async function createThread(input: NewThread, exec: Exec = db): Promise<ConversationRow> {
  const [row] = await exec
    .insert(conversations)
    .values({
      workspaceId: input.workspaceId,
      startedBy: input.userId,
      startedVia: input.startedVia,
      kind: input.kind,
      brandId: input.brandId,
    })
    .returning();
  return row;
}

/** Closes the person's open thread in this workspace, if there is one. */
export async function closeOpenThreadFor(workspaceId: string, userId: string, reason: CloseReason, exec: Exec = db): Promise<void> {
  const now = new Date();
  await exec
    .update(conversations)
    .set({ status: "closed", closedReason: reason, closedAt: now, updatedAt: now })
    .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.startedBy, userId), eq(conversations.status, "open")));
}

/**
 * Publishing a post closes the thread linked to it. Called from the publish pipeline
 * (lib/pipelines/publish.ts) right after a post becomes `published`.
 */
export async function closeThreadsForPost(postId: string, exec: Pick<typeof db, "update"> = db): Promise<void> {
  const now = new Date();
  await exec
    .update(conversations)
    .set({ status: "closed", closedReason: "published", closedAt: now, updatedAt: now })
    .where(and(eq(conversations.postId, postId), eq(conversations.status, "open")));
}

export async function updateThread(id: string, patch: { kind?: ConversationKind; brandId?: string }, exec: Exec = db): Promise<ConversationRow> {
  const [row] = await exec
    .update(conversations)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return row;
}

export interface NewMessage {
  conversationId: string;
  direction: MessageDirection;
  channel: MessageChannel;
  body: string;
  authorUserId?: string | null;
  providerMessageId?: string | null;
  /** The editor job whose cuts this reply carries (lib/editor). */
  editorJobId?: string | null;
}

export async function addMessage(input: NewMessage, exec: Exec = db): Promise<MessageRow> {
  const [row] = await exec
    .insert(conversationMessages)
    .values({
      conversationId: input.conversationId,
      direction: input.direction,
      channel: input.channel,
      body: input.body,
      authorUserId: input.authorUserId ?? null,
      providerMessageId: input.providerMessageId ?? null,
      editorJobId: input.editorJobId ?? null,
    })
    .returning();
  await exec.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
  return row;
}

/** Whether this thread has already asked "Which brand?" (it asks once). */
export async function hasAskedBrand(conversationId: string, exec: Exec = db): Promise<boolean> {
  const [row] = await exec
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.direction, "out"),
        like(conversationMessages.body, `%${BRAND_QUESTION_PREFIX}%`),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function findMessageByProviderId(providerMessageId: string, exec: Exec = db): Promise<MessageRow | null> {
  const [row] = await exec
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.providerMessageId, providerMessageId))
    .limit(1);
  return row ?? null;
}

/** The reply that followed a message (for answering a retried webhook the same way). */
export async function replyAfter(message: MessageRow, exec: Exec = db): Promise<string | null> {
  const [row] = await exec
    .select({ body: conversationMessages.body })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, message.conversationId),
        eq(conversationMessages.direction, "out"),
        or(gt(conversationMessages.createdAt, message.createdAt), eq(conversationMessages.createdAt, message.createdAt)),
      ),
    )
    .orderBy(asc(conversationMessages.createdAt))
    .limit(1);
  return row?.body ?? null;
}

export interface ThreadSummary {
  id: string;
  kind: ConversationKind | null;
  status: "open" | "closed";
  startedVia: MessageChannel;
  brandId: string | null;
  mine: boolean;
  createdAt: Date;
  updatedAt: Date;
  closedReason: string | null;
  lastMessage: { body: string; direction: MessageDirection; channel: MessageChannel; createdAt: Date } | null;
}

/**
 * Threads for one brand, newest first, plus the workspace's threads that have no brand yet
 * (so a thread waiting on "Which brand?" does not disappear).
 */
export async function listThreads(workspaceId: string, brandId: string, viewerId: string, limit = 100): Promise<ThreadSummary[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), or(eq(conversations.brandId, brandId), isNull(conversations.brandId))))
    .orderBy(desc(conversations.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const last = await db
    .selectDistinctOn([conversationMessages.conversationId], {
      conversationId: conversationMessages.conversationId,
      body: conversationMessages.body,
      direction: conversationMessages.direction,
      channel: conversationMessages.channel,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(inArray(conversationMessages.conversationId, rows.map((r) => r.id)))
    .orderBy(conversationMessages.conversationId, desc(conversationMessages.createdAt), sql`${conversationMessages.direction} desc`);
  const byThread = new Map(last.map((m) => [m.conversationId, m]));
  return rows.map((r) => {
    const m = byThread.get(r.id);
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      startedVia: r.startedVia,
      brandId: r.brandId,
      mine: r.startedBy === viewerId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      closedReason: r.closedReason,
      lastMessage: m ? { body: m.body, direction: m.direction, channel: m.channel, createdAt: m.createdAt } : null,
    };
  });
}

/** A thread's messages, oldest first. */
export async function listMessages(conversationId: string): Promise<MessageRow[]> {
  return db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.direction));
}
