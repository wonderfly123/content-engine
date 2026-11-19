/**
 * One inbound message, from a text or from the app, through the routing rules into its thread:
 *
 *  - "new reel" / "new story" (or the app's buttons) closes the person's open thread, opens a new one.
 *  - Anything else goes to the person's open thread (by text), or the thread they are looking at
 *    (in the app); with none open, a new one opens and asks "Reel or story?".
 *  - Answers to "Reel or story?" / "Which brand?" are remembered on the thread.
 *  - "yes" asks the editor seam to approve this thread's pending preview.
 *  - Everything else is handed to the editor (lib/conversations/editor.ts).
 *
 * The reply is stored in the thread on the channel the message came from; the caller delivers it
 * (a Salesmsg text for a text, the API response for the app).
 */
import { createHash } from "node:crypto";
import { AccessError, listMemberships } from "@/lib/auth/workspace";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ConversationKind, MessageChannel } from "@/lib/db/enums";
import { ASK_WHEN, currentCut, scheduleCurrentCut, UNDO_WORDS, unscheduleCurrentCut } from "@/lib/editor/approval";
import type { ConversationAccess } from "./access";
import { approvePendingPreview, handOffToEditor, type EditorHandoff } from "./editor";
import { parsePostTime } from "./post-time";
import { normalizePhone } from "./phone";
import { findVerifiedUserByPhone, phoneBrandIds } from "./phones";
import { carrierKeyword, decide, isApproval, normalize, NO_BRAND_REPLY, NOTHING_TO_APPROVE, replyFor, UNKNOWN_NUMBER_REPLY, type Decision } from "./router";
import {
  activeBrands,
  addMessage,
  closeThread,
  createThread,
  findMessageByProviderId,
  findOpenThreads,
  getThread,
  hasAskedBrand,
  replyAfter,
  updateThread,
  type ConversationRow,
} from "./store";
import { appUrl } from "./texting";
import { uploadLinkPath } from "./upload-link";

export const MAX_BODY_CHARS = 1600;

export interface InboundInput {
  workspaceId: string;
  userId: string;
  channel: MessageChannel;
  body: string;
  /** Salesmsg message id: a retried webhook with the same id is stored once. */
  providerMessageId?: string | null;
  /** App only: the thread the person is looking at (already checked with requireConversation). */
  threadId?: string;
  /** App only: the New reel / New story buttons name the brand directly. */
  brandId?: string;
  /** For the link back to the thread when APP_URL is not set. */
  origin?: string | null;
  /** Texts only: the brands the sender's number texts for. Other brands are never offered or reached. */
  allowedBrandIds?: string[];
}

export interface InboundResult {
  conversationId: string | null;
  reply: string | null;
  duplicate?: boolean;
}

export class ThreadClosedError extends Error {
  constructor() {
    super("This thread is closed. Start a new reel or story.");
    this.name = "ThreadClosedError";
  }
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
  return e?.code === "23505" || e?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(e?.message ?? "");
};

async function duplicateOf(providerMessageId: string | null | undefined): Promise<InboundResult | null> {
  if (!providerMessageId) return null;
  const dup = await findMessageByProviderId(providerMessageId);
  if (!dup) return null;
  return { conversationId: dup.conversationId, reply: await replyAfter(dup), duplicate: true };
}

/** "[Cider stand opening] …": every text about a named video starts with its name. */
export const withName = (thread: Pick<ConversationRow, "title">, text: string) => (thread.title ? `[${thread.title}] ${text}` : text);

/**
 * "fall arch: shorter" aims a text at the open video named "Fall Arch…". Returns that thread and
 * the rest of the text, or null when the text doesn't start with a name.
 */
export function pickByName(body: string, threads: ConversationRow[]): { thread: ConversationRow; rest: string } | null {
  const m = /^\s*\[?([^:\]\n]{2,60})\]?\s*:\s*([\s\S]+)$/.exec(body);
  if (!m) return null;
  const said = normalize(m[1]);
  const hits = threads.filter((t) => {
    const title = t.title ? normalize(t.title) : "";
    return title && (title === said || title.startsWith(said) || said.startsWith(title));
  });
  return hits.length === 1 ? { thread: hits[0], rest: m[2].trim() } : null;
}

/** Of these threads, the ones with a cut waiting for approval. */
async function awaitingApproval(threadIds: string[]): Promise<Set<string>> {
  if (threadIds.length === 0) return new Set();
  const rows = await db
    .select({ id: schema.editorJobs.conversationId })
    .from(schema.editorJobs)
    .where(and(inArray(schema.editorJobs.conversationId, threadIds), eq(schema.editorJobs.status, "done"), isNotNull(schema.editorJobs.manifest)));
  return new Set(rows.map((r) => r.id));
}

/**
 * A time ("tonight", "tomorrow 9am", "now") for a thread whose cut is approved, or UNDO for one
 * that's scheduled. Stores the exchange in the thread and returns the reply; null when the message
 * is something else.
 */
async function afterApproval(input: InboundInput, thread: ConversationRow, body: string): Promise<InboundResult | null> {
  const undo = UNDO_WORDS.has(normalize(body));
  const time = undo ? null : parsePostTime(body);
  if (!undo && !time) return null;
  const current = await currentCut(thread.id);
  if (!current) return null;
  if (time && current.stage !== "approved") return null;
  if (undo && current.stage !== "scheduled") return null;

  const memberships = await listMemberships(input.userId);
  const membership = memberships.find((m) => m.workspaceId === thread.workspaceId);
  if (!membership) return null;
  const access: ConversationAccess = {
    user: { userId: input.userId, email: "", role: "user", status: "active" },
    workspaceId: thread.workspaceId,
    role: membership.role,
    conversation: thread,
  };
  await addMessage({ conversationId: thread.id, direction: "in", channel: input.channel, body, authorUserId: input.userId, providerMessageId: input.providerMessageId });
  let reply: string;
  if (undo) {
    reply = (await unscheduleCurrentCut(access)) ? `Unscheduled. ${ASK_WHEN}` : "It's already posting, so it can't be stopped now.";
  } else {
    try {
      const done = await scheduleCurrentCut(access, time!.when, time!.now);
      reply = done ? `${done.line}${time!.now ? "" : " Reply UNDO to unschedule."}` : NOTHING_TO_APPROVE;
    } catch (err) {
      reply = `Couldn't schedule it: ${(err as Error).message}`;
    }
  }
  await addMessage({ conversationId: thread.id, direction: "out", channel: input.channel, body: reply });
  return { conversationId: thread.id, reply: input.channel === "sms" ? withName(thread, reply) : reply };
}

export async function handleInbound(input: InboundInput): Promise<InboundResult> {
  let body = input.body.trim().slice(0, MAX_BODY_CHARS);
  const seen = await duplicateOf(input.providerMessageId);
  if (seen) return seen;

  const allowed = input.allowedBrandIds;
  const brands = (await activeBrands(input.workspaceId)).filter((b) => !allowed || allowed.includes(b.id));
  const single = brands.length === 1 ? brands[0].id : null;
  let target: ConversationRow | null;
  // Open threads for brands the number has been turned off for are closed, never written to.
  let offBrand: ConversationRow[] = [];
  let open: ConversationRow[] = [];
  if (input.threadId) {
    target = await getThread(input.threadId, input.workspaceId);
  } else {
    const all = await findOpenThreads(input.workspaceId, input.userId);
    offBrand = allowed ? all.filter((t) => t.brandId && !allowed.includes(t.brandId)) : [];
    // Campaign chats are app only (lib/campaigns/chat.ts): a text never lands in one.
    open = all.filter((t) => !offBrand.includes(t) && t.kind !== "campaign");
    const named = pickByName(body, open);
    if (named) body = named.rest;
    // Aimed by name, else the video the person last heard about.
    target = named?.thread ?? open[0] ?? null;
    if (!named && open.length > 1 && isApproval(body)) {
      const waiting = await awaitingApproval(open.map((t) => t.id));
      const choices = open.filter((t) => waiting.has(t.id) && t.title);
      if (choices.length > 1) {
        const names = choices.map((t) => `"${t.title}"`);
        return {
          conversationId: null,
          reply: `Which one: ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}? Reply with its name first, like "${choices[0].title}: yes".`,
        };
      }
    }
  }
  // The messages route hands campaign chats to lib/campaigns/chat.ts; they never take this path.
  if (target?.kind === "campaign") throw new AccessError(404, "Not found.");
  // After approval: a time schedules it, UNDO takes it off the calendar (texts and app alike).
  if (target && target.status === "open") {
    const after = await afterApproval(input, target, body);
    if (after) return after;
  }

  const state = target ? { kind: target.kind, brandId: target.brandId } : { kind: null, brandId: single };
  const decided = decide({ body, channel: input.channel, thread: state, brands });
  const decision: Decision =
    decided.type === "new_thread" && input.brandId && brands.some((b) => b.id === input.brandId) ? { ...decided, brandId: input.brandId } : decided;

  // A thread id from another workspace is never a way in (the routes have already said 404).
  if (input.threadId && !target) throw new AccessError(404, "Not found.");
  if (decision.type === "keyword") return { conversationId: target?.id ?? null, reply: null };
  if (target && target.status !== "open" && decision.type !== "new_thread") throw new ThreadClosedError();
  if (decision.type === "approve" && !target) return { conversationId: null, reply: NOTHING_TO_APPROVE };

  let thread: ConversationRow;
  let inboundId: string;
  try {
    ({ thread, inboundId } = await db.transaction(async (tx) => {
      let t: ConversationRow;
      for (const off of offBrand) await closeThread(off.id, "brand_texting_off", tx);
      if (decision.type === "new_thread") {
        // Several can run at once: starting one never closes another.
        t = await createThread({ workspaceId: input.workspaceId, userId: input.userId, startedVia: input.channel, kind: decision.kind, brandId: decision.brandId }, tx);
      } else if (!target) {
        t = await createThread({ workspaceId: input.workspaceId, userId: input.userId, startedVia: input.channel, kind: null, brandId: single }, tx);
      } else {
        t = target;
      }
      const patch: { kind?: ConversationKind; brandId?: string } = {};
      if (decision.type === "answer" && decision.kind && !t.kind) patch.kind = decision.kind;
      if ((decision.type === "answer" || decision.type === "message") && decision.brandId && !t.brandId) patch.brandId = decision.brandId;
      if (Object.keys(patch).length > 0) t = await updateThread(t.id, patch, tx);
      const inbound = await addMessage(
        { conversationId: t.id, direction: "in", channel: input.channel, body, authorUserId: input.userId, providerMessageId: input.providerMessageId },
        tx,
      );
      return { thread: t, inboundId: inbound.id };
    }));
  } catch (err) {
    // Two deliveries of the same text at once: the second loses the race on the unique id.
    if (isUniqueViolation(err)) {
      const dup = await duplicateOf(input.providerMessageId);
      if (dup) return dup;
    }
    throw err;
  }

  let editor: EditorHandoff | undefined;
  let reply: string | null;
  if (decision.type === "message") editor = await handOffToEditor(thread.id, inboundId, input.origin);
  if (decision.type === "approve") {
    const approval = await approvePendingPreview(thread.id);
    reply = approval.approved ? (input.channel === "sms" ? `Approved. ${ASK_WHEN}` : "Approved. Pick when it posts below the cut.") : NOTHING_TO_APPROVE;
  } else {
    reply = replyFor(
      decision,
      {
        channel: input.channel,
        thread: { kind: thread.kind, brandId: thread.brandId },
        brands,
        askedBrand: await hasAskedBrand(thread.id),
        link: input.channel === "sms" ? `${appUrl(input.origin)}${uploadLinkPath(thread.id)}` : `${appUrl(input.origin)}/chats/${thread.id}`,
      },
      editor,
    );
  }
  if (reply) await addMessage({ conversationId: thread.id, direction: "out", channel: input.channel, body: reply });
  // Texts carry the video's name; the thread itself shows it in its header instead.
  return { conversationId: thread.id, reply: reply && input.channel === "sms" ? withName(thread, reply) : reply };
}

// ---------------------------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------------------------

/**
 * Unknown numbers get one short reply, then silence for a day, so two automated senders cannot
 * text each other forever. Kept in memory only (a hash of the number, never the number), per
 * server instance: nothing about an unknown sender is written to the database.
 */
const UNKNOWN_REPLY_EVERY_MS = 24 * 60 * 60 * 1000;
const repliedToUnknown = new Map<string, number>();

export function resetUnknownNumberMemory(): void {
  repliedToUnknown.clear();
}

function unknownNumberReply(phone: string, reply: string = UNKNOWN_NUMBER_REPLY, now = Date.now()): string | null {
  const key = createHash("sha256").update(phone).digest("hex");
  const last = repliedToUnknown.get(key);
  if (last !== undefined && now - last < UNKNOWN_REPLY_EVERY_MS) return null;
  if (repliedToUnknown.size > 10_000) repliedToUnknown.clear();
  repliedToUnknown.set(key, now);
  return reply;
}

export interface IncomingText {
  from: string;
  body: string;
  messageSid: string | null;
  origin?: string | null;
}

/**
 * A text from Salesmsg (the webhook token is already checked). The sender is known only by a confirmed
 * phone number, and reaches only the brands that number is turned on for: none and they are told to
 * turn it on; one and the text goes straight to it; several and the editor asks which. Brands in
 * several workspaces: the workspace of the brand turned on first.
 */
export async function handleIncomingText(input: IncomingText): Promise<string | null> {
  const phone = normalizePhone(input.from);
  if (!phone) return null;
  const keyword = carrierKeyword(input.body);
  const userId = await findVerifiedUserByPhone(phone);
  if (!userId) return keyword ? null : unknownNumberReply(phone);
  const brandIds = await phoneBrandIds(userId);
  const memberships = await listMemberships(userId);
  const workspaceOf = new Map(
    (brandIds.length ? await db.select({ id: schema.brands.id, workspaceId: schema.brands.workspaceId }).from(schema.brands).where(inArray(schema.brands.id, brandIds)) : []).map(
      (b) => [b.id, b.workspaceId],
    ),
  );
  const workspaceId = brandIds.map((id) => workspaceOf.get(id)).find((ws) => ws && memberships.some((m) => m.workspaceId === ws));
  if (!workspaceId) return keyword ? null : unknownNumberReply(phone, NO_BRAND_REPLY);
  const result = await handleInbound({
    workspaceId,
    userId,
    channel: "sms",
    body: input.body,
    providerMessageId: input.messageSid,
    origin: input.origin,
    allowedBrandIds: brandIds.filter((id) => workspaceOf.get(id) === workspaceId),
  });
  return result.reply;
}
