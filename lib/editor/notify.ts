/**
 * Posting the editor's own messages into a thread outside a webhook reply (the worker's callback,
 * the stuck-job sweep, the clips-added hand-off, the Approve button).
 *
 * A thread answers on the channel its last inbound message came by: when that was a text, the
 * message is stored as a text and also sent by text (best effort: a failed text never loses the
 * message, which is in the thread either way). Never logs message bodies or phone numbers.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { addMessage, type ConversationRow, type MessageRow } from "@/lib/conversations/store";
import { appUrl, isTextingConfigured, sendSms } from "@/lib/conversations/texting";
import { db, schema } from "@/lib/db";
import type { MessageChannel } from "@/lib/db/enums";

const { conversationMessages, memberPhoneBrands, memberPhones } = schema;
const MAX_TEXT_CHARS = 1600;

/** The channel and author of the thread's last inbound message (app, when there is none). */
export async function lastInbound(conversationId: string): Promise<{ channel: MessageChannel; authorUserId: string | null }> {
  const [row] = await db
    .select({ channel: conversationMessages.channel, authorUserId: conversationMessages.authorUserId })
    .from(conversationMessages)
    .where(and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.direction, "in")))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(1);
  return row ?? { channel: "app", authorUserId: null };
}

export const threadLink = (conversationId: string): string => `${appUrl()}/conversations/${conversationId}`;

export interface PostOptions {
  editorJobId?: string | null;
  /** Force a channel (the Approve button answers in the app); default: the last inbound message's. */
  channel?: MessageChannel;
  /** Add a link to the thread to the text version (the thread itself never shows it). */
  linkInText?: boolean;
}

export async function postEditorMessage(thread: ConversationRow, body: string, opts: PostOptions = {}): Promise<MessageRow> {
  const last = await lastInbound(thread.id);
  const channel = opts.channel ?? last.channel;
  const message = await addMessage({ conversationId: thread.id, direction: "out", channel, body, editorJobId: opts.editorJobId ?? null });
  if (channel === "sms") {
    const text = opts.linkInText ? `${body}\n${threadLink(thread.id)}` : body;
    await textMember(last.authorUserId ?? thread.startedBy, text, thread.brandId);
  }
  return message;
}

/**
 * Texts one member at their confirmed number, when texting is on (best effort). For a thread with a
 * brand, only when the number is turned on for that brand.
 */
export async function textMember(userId: string, body: string, brandId?: string | null): Promise<void> {
  if (!isTextingConfigured()) return;
  if (brandId) {
    const [on] = await db
      .select({ brandId: memberPhoneBrands.brandId })
      .from(memberPhoneBrands)
      .where(and(eq(memberPhoneBrands.userId, userId), eq(memberPhoneBrands.brandId, brandId)))
      .limit(1);
    if (!on) return;
  }
  const [phone] = await db
    .select({ phone: memberPhones.phoneE164 })
    .from(memberPhones)
    .where(and(eq(memberPhones.userId, userId), isNotNull(memberPhones.verifiedAt)))
    .limit(1);
  if (!phone) return;
  try {
    await sendSms(phone.phone, body.slice(0, MAX_TEXT_CHARS));
  } catch {
    console.warn("[editor] could not send the text; the message is in the thread.");
  }
}
