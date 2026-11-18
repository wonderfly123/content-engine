/**
 * "It's live": when a post made from a conversation publishes, the thread gets the link, and the
 * person gets it by text when the thread runs by text. Registered at module load; the publish cron
 * route imports this file (app/api/cron/publish/route.ts).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { lastInbound, textMember } from "@/lib/editor/notify";
import { onPostPublished, type PublishedPost } from "@/lib/pipelines/published-hooks";
import { addMessage } from "./store";

export async function tellThreadsItsLive(post: PublishedPost): Promise<void> {
  for (const id of post.conversationIds) {
    const [thread] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).limit(1);
    if (!thread) continue;
    const body = post.externalUrl ? `It's live: ${post.externalUrl}` : "It's live on Instagram.";
    const last = await lastInbound(thread.id);
    await addMessage({ conversationId: thread.id, direction: "out", channel: last.channel, body });
    if (last.channel === "sms") await textMember(last.authorUserId ?? thread.startedBy, `${thread.title ? `[${thread.title}] ` : ""}${body}`, thread.brandId);
  }
}

onPostPublished(tellThreadsItsLive);
