/**
 * Making a campaign's videos, one at a time, only when the person says go:
 *
 *   startNextItem -> the first planned item -> ONE editor job with its brief and its library clips
 *   reviseItem    -> "make the hook bigger" on the item waiting for approval -> a revision of that item
 *   approveItem   -> that item's job approved, then scheduled at the item's plan date (stories as stories)
 *
 * Nothing starts the next item by itself: approving one only says what's next.
 */
import { and, eq } from "drizzle-orm";
import type { ConversationAccess } from "@/lib/conversations/access";
import { describePostTime } from "@/lib/conversations/post-time";
import type { ConversationRow } from "@/lib/conversations/store";
import { db, schema } from "@/lib/db";
import { activeJob, recoverStuckEditorJobs } from "@/lib/editor/jobs";
import { scheduleEditorCut } from "@/lib/editor/schedule";
import { dispatchEditorJob, REPLIES } from "@/lib/editor/submit";
import { activeItem, campaignFor, itemStates, libraryMedia, nextPlanned, threadClips, type CampaignRow, type ItemState, type MediaRow } from "./store";

const { brands, campaigns, editorJobs } = schema;

export const CAMPAIGN_REPLIES = {
  noPlan: "There's no plan yet. Tell me about the campaign, and say \"make the plan\" when you're ready.",
  allDone: "Every video in the plan is made. Add more to the plan if you want to keep going.",
  nothingToApprove: "There's no video waiting for approval.",
  noFootage: (n: number) => `There's no footage for #${n} yet. Upload clips here, or ask me to pick library clips for it.`,
  editing: (n: number) => `Still making #${n}. I'll post it here as soon as it's ready.`,
  waiting: (n: number) => `#${n} is ready above: approve it, or tell me what to change first.`,
} as const;

export interface RunResult {
  queued: boolean;
  reply: string;
}

/** What the worker is asked to make for one item. */
export function itemBrief(campaign: CampaignRow, item: ItemState["item"], total: number): string {
  return [
    `Campaign video #${item.position} of ${total}: "${item.title}".`,
    `Make exactly one cut, ${item.lengthSec} seconds long, as a ${item.format}.`,
    item.angle && `Angle: ${item.angle}`,
    item.hook && `Open on this hook: ${item.hook}`,
    item.music && `Music and pacing: ${item.music}`,
    "The clips were chosen from the brand's library for this video; use the ones that fit the brief best.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The campaign as standing instructions for every one of its videos. */
export const campaignInstructions = (c: CampaignRow) =>
  [c.name && `Campaign: ${c.name}.`, c.theme && `Theme: ${c.theme}.`, c.goal && `Goal: ${c.goal}.`, c.audience && `Audience: ${c.audience}.`].filter(Boolean).join(" ");

/** The item's library clips (this workspace and brand only), else the campaign chat's own uploads. */
async function itemClips(thread: ConversationRow, campaign: CampaignRow, item: ItemState["item"]): Promise<MediaRow[]> {
  const library = await libraryMedia(item.assetIds, campaign.brandId, thread.workspaceId);
  return library.length > 0 ? library : threadClips(thread.id, thread.workspaceId);
}

async function brandOf(campaign: CampaignRow, workspaceId: string) {
  const [brand] = await db.select().from(brands).where(and(eq(brands.id, campaign.brandId), eq(brands.workspaceId, workspaceId))).limit(1);
  return brand ?? null;
}

async function send(
  thread: ConversationRow,
  campaign: CampaignRow,
  state: ItemState,
  request: string,
  triggerMessageId: string | null,
  origin?: string | null,
): Promise<{ queued: boolean; reply: string | null }> {
  const clips = await itemClips(thread, campaign, state.item);
  if (clips.length === 0) return { queued: false, reply: CAMPAIGN_REPLIES.noFootage(state.item.position) };
  await recoverStuckEditorJobs(new Date(), thread.id);
  if (await activeJob(thread.id)) return { queued: false, reply: REPLIES.busy };
  const brand = await brandOf(campaign, thread.workspaceId);
  if (!brand) return { queued: false, reply: REPLIES.refused };
  const handoff = await dispatchEditorJob({
    thread,
    brand,
    kind: state.manifest ? "revision" : "first_cut",
    videoKind: state.item.format === "story" ? "story" : "reel",
    request,
    instructions: campaignInstructions(campaign),
    clips,
    previous: state.manifest,
    triggerMessageId,
    campaignItemId: state.item.id,
    origin,
  });
  return { queued: handoff.queued, reply: handoff.reply ?? null };
}

/** "Go": approves the calendar if it wasn't yet, then starts exactly one job for the next planned item. */
export async function startNextItem(thread: ConversationRow, triggerMessageId: string | null, origin?: string | null): Promise<RunResult> {
  const campaign = await campaignFor(thread);
  if (!campaign) return { queued: false, reply: CAMPAIGN_REPLIES.noPlan };
  const states = await itemStates(campaign);
  if (states.length === 0) return { queued: false, reply: CAMPAIGN_REPLIES.noPlan };
  const active = activeItem(states);
  if (active) return { queued: false, reply: active.status === "ready" ? CAMPAIGN_REPLIES.waiting(active.item.position) : CAMPAIGN_REPLIES.editing(active.item.position) };
  const next = nextPlanned(states);
  if (!next) return { queued: false, reply: CAMPAIGN_REPLIES.allDone };
  if (!campaign.calendarApprovedAt) await approveCalendar(campaign);
  const sent = await send(thread, campaign, next, itemBrief(campaign, next.item, states.length), triggerMessageId, origin);
  if (!sent.queued) return { queued: false, reply: sent.reply ?? REPLIES.refused };
  const { position, title, lengthSec, format } = next.item;
  return { queued: true, reply: `Making #${position}: ${title} (${lengthSec}s ${format}). I'll post it here when it's ready.` };
}

/** A change asked for (or an answer to the editor's question) on the item waiting for approval. */
export async function reviseItem(thread: ConversationRow, state: ItemState, total: number, messageId: string, body: string, origin?: string | null): Promise<RunResult> {
  const campaign = await campaignFor(thread);
  if (!campaign) return { queued: false, reply: CAMPAIGN_REPLIES.noPlan };
  const request = `${body}\n\n(This is about the campaign video below.)\n${itemBrief(campaign, state.item, total)}`;
  const sent = await send(thread, campaign, state, request, messageId, origin);
  if (!sent.queued) return { queued: false, reply: sent.reply ?? REPLIES.refused };
  return { queued: true, reply: `On it: a new version of #${state.item.position}. I'll post it here when it's ready.` };
}

export async function approveCalendar(campaign: CampaignRow): Promise<void> {
  const now = new Date();
  await db.update(campaigns).set({ calendarApprovedAt: now, updatedAt: now }).where(eq(campaigns.id, campaign.id));
}

/**
 * Approves one item's cut (by its job, or the item waiting for approval) and schedules it at the
 * item's plan date. An approved item that could not be scheduled is scheduled again here.
 */
export async function approveItem(access: ConversationAccess, jobId?: string | null): Promise<{ ok: boolean; reply: string }> {
  const thread = access.conversation;
  const campaign = await campaignFor(thread);
  if (!campaign) return { ok: false, reply: CAMPAIGN_REPLIES.nothingToApprove };
  const states = await itemStates(campaign);
  const state = jobId ? states.find((s) => s.jobId === jobId.toLowerCase()) : states.find((s) => s.status === "ready");
  if (!state || !state.jobId || !state.manifest || (state.status !== "ready" && state.status !== "approved")) {
    return { ok: false, reply: CAMPAIGN_REPLIES.nothingToApprove };
  }
  if (state.status === "ready") {
    const now = new Date();
    await db
      .update(editorJobs)
      .set({ status: "approved", approvedAt: now, updatedAt: now })
      .where(and(eq(editorJobs.id, state.jobId), eq(editorJobs.conversationId, thread.id), eq(editorJobs.workspaceId, access.workspaceId), eq(editorJobs.status, "done")));
  }
  const { item } = state;
  const next = states.find((s) => s.status === "planned" && s.item.id !== item.id);
  const after = next ? ` Say go (or tap Make next video) when you want #${next.item.position}.` : " That was the last one in the plan.";
  try {
    const done = await scheduleEditorCut({
      access,
      jobId: state.jobId,
      cutId: state.manifest.cuts[0].id,
      when: item.postAt,
      format: item.format === "story" ? "story" : "reel",
      title: item.title,
      linkThread: false,
    });
    return { ok: true, reply: `Approved #${item.position}. Scheduled for ${describePostTime(done.when)}.${after}` };
  } catch (err) {
    return { ok: true, reply: `Approved #${item.position}, but I couldn't schedule it: ${(err as Error).message} Approve it again to retry.${after}` };
  }
}
