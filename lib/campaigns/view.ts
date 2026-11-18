/**
 * What the pinned plan at the top of a campaign chat shows: each video, its brief, its library clips
 * by name, its post date and where it stands. Only what the page shows; asset ids only for clips of
 * this brand's own library.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { ConversationRow } from "@/lib/conversations/store";
import { db, schema } from "@/lib/db";
import { activeItem, campaignFor, itemStates, nextPlanned, type ItemStatus } from "./store";

export interface CampaignItemView {
  id: string;
  number: number;
  title: string;
  angle: string;
  hook: string;
  lengthSec: number;
  format: string;
  music: string;
  postAt: string;
  status: ItemStatus;
  clips: Array<{ assetId: string; label: string }>;
}

export interface CampaignView {
  name: string;
  theme: string;
  goal: string;
  audience: string;
  planWritten: boolean;
  calendarApproved: boolean;
  items: CampaignItemView[];
  /** "Make next video" is offered: the calendar may still need approving (go approves it). */
  canMakeNext: boolean;
  /** The video being made or waiting for approval, by number. */
  active: number | null;
}

export async function campaignView(thread: ConversationRow): Promise<CampaignView | null> {
  if (thread.kind !== "campaign") return null;
  const campaign = await campaignFor(thread);
  if (!campaign) return null;
  const states = await itemStates(campaign);
  const ids = [...new Set(states.flatMap((s) => s.item.assetIds))];
  const labels = ids.length
    ? await db
        .select({ id: schema.assets.id, label: schema.assets.label })
        .from(schema.assets)
        .where(and(inArray(schema.assets.id, ids), eq(schema.assets.brandId, campaign.brandId)))
    : [];
  const labelOf = new Map(labels.map((l) => [l.id, l.label]));
  const active = activeItem(states);
  return {
    name: campaign.name,
    theme: campaign.theme,
    goal: campaign.goal,
    audience: campaign.audience,
    planWritten: Boolean(campaign.planWrittenAt),
    calendarApproved: Boolean(campaign.calendarApprovedAt),
    items: states.map(({ item, status }) => ({
      id: item.id,
      number: item.position,
      title: item.title,
      angle: item.angle,
      hook: item.hook,
      lengthSec: item.lengthSec,
      format: item.format,
      music: item.music,
      postAt: item.postAt.toISOString(),
      status,
      clips: item.assetIds.filter((id) => labelOf.has(id)).map((id) => ({ assetId: id, label: labelOf.get(id)! })),
    })),
    canMakeNext: !active && Boolean(nextPlanned(states)),
    active: active?.item.position ?? null,
  };
}
