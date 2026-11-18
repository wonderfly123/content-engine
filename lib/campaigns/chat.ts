/**
 * One message in a campaign chat (app only; texts never reach a campaign):
 *
 *  - A video is ready: "yes" approves and schedules it; anything else is a change to it.
 *  - The editor asked about the video in progress: the message answers it (a revision).
 *  - "go" / "next": makes the next planned video (exactly one job).
 *  - Everything else is the brainstorm: the editor (lib/campaigns/brainstorm.ts) answers, and writes,
 *    changes or approves the plan, or starts the next video, when the person asks.
 */
import { addMessage, createThread, type ConversationRow } from "@/lib/conversations/store";
import type { ConversationAccess } from "@/lib/conversations/access";
import { isApproval, normalize } from "@/lib/conversations/router";
import { db, schema } from "@/lib/db";
import { REPLIES } from "@/lib/editor/submit";
import { brainstorm } from "./brainstorm";
import { applyPlan } from "./plan";
import { approveCalendar, approveItem, CAMPAIGN_REPLIES, reviseItem, startNextItem } from "./run";
import { activeItem, brandLibrary, campaignFor, itemStates } from "./store";

export const CAMPAIGN_OPENER =
  "Let's plan a campaign. What's it about, what should it achieve, and who is it for? I can see your clip library, so I'll suggest which footage fits. When you're ready, say \"make the plan\".";
export const THINKING_FAILED = "Sorry, I couldn't think that through. Send it again in a minute.";

const GO_WORDS = new Set(["go", "next", "go next", "next one", "next video", "make next", "make the next one", "make next video", "make the next video", "start", "lets go", "go ahead and make the next one"]);
export const isGo = (body: string) => GO_WORDS.has(normalize(body));

/** "New campaign": a chat of kind campaign for this brand, with its campaign row and the editor's first question. */
export async function createCampaign(input: { workspaceId: string; userId: string; brandId: string }): Promise<ConversationRow> {
  return db.transaction(async (tx) => {
    const thread = await createThread({ workspaceId: input.workspaceId, userId: input.userId, startedVia: "app", kind: "campaign", brandId: input.brandId }, tx);
    await tx.insert(schema.campaigns).values({ workspaceId: input.workspaceId, brandId: input.brandId, conversationId: thread.id });
    await addMessage({ conversationId: thread.id, direction: "out", channel: "app", body: CAMPAIGN_OPENER }, tx);
    return thread;
  });
}

export interface CampaignMessageInput {
  access: ConversationAccess;
  body: string;
  origin?: string | null;
}

/** Stores the person's message, decides what it means, stores and returns the reply. */
export async function handleCampaignMessage(input: CampaignMessageInput): Promise<{ conversationId: string; reply: string }> {
  const { access, body, origin } = input;
  const thread = access.conversation;
  const inbound = await addMessage({ conversationId: thread.id, direction: "in", channel: "app", body, authorUserId: access.user.userId });
  const reply = await decideReply(access, body, inbound.id, origin);
  await addMessage({ conversationId: thread.id, direction: "out", channel: "app", body: reply });
  return { conversationId: thread.id, reply };
}

async function decideReply(access: ConversationAccess, body: string, messageId: string, origin?: string | null): Promise<string> {
  const thread = access.conversation;
  const campaign = await campaignFor(thread);
  if (!campaign) return CAMPAIGN_REPLIES.noPlan;
  const states = await itemStates(campaign);
  const active = activeItem(states);

  if (active?.status === "ready") {
    if (isApproval(body)) return (await approveItem(access, active.jobId)).reply;
    if (isGo(body)) return CAMPAIGN_REPLIES.waiting(active.item.position);
    return (await reviseItem(thread, active, states.length, messageId, body, origin)).reply;
  }
  if (active?.waitingForAnswer) return (await reviseItem(thread, active, states.length, messageId, body, origin)).reply;
  if (active && isGo(body)) return CAMPAIGN_REPLIES.editing(active.item.position);
  if (!active && states.length > 0 && isGo(body)) return (await startNextItem(thread, messageId, origin)).reply;

  const library = await brandLibrary(campaign.brandId, thread.workspaceId);
  const out = await brainstorm({ workspaceId: thread.workspaceId, brandId: campaign.brandId, conversationId: thread.id, campaign, states, library });
  if ("error" in out) return out.error === "no_key" ? REPLIES.noKey : THINKING_FAILED;
  const said = out.reply.trim();
  if (out.action === "write_plan") {
    const applied = await applyPlan(campaign, out.plan, states, library);
    if ("error" in applied) return `${applied.error} ${THINKING_FAILED}`;
    return said || "Here's the plan. Approve it and its calendar when it looks right.";
  }
  if (out.action === "approve_plan" && states.length > 0) {
    await approveCalendar(campaign);
    return said || "Plan and calendar approved. Say go when you want the first video.";
  }
  if (out.action === "make_next" && states.length > 0) {
    const started = await startNextItem(thread, messageId, origin);
    return [said, started.reply].filter(Boolean).join("\n\n");
  }
  return said || THINKING_FAILED;
}
