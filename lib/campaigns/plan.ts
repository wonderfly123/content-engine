/**
 * Writing the editor's plan into the campaign. The model's draft is checked here (zod) and never
 * trusted: lengths are 15/30/60, formats reel/story, clip refs map only to this brand's library,
 * times must parse (else they are spread out from tomorrow), and at most MAX_ITEMS videos.
 *
 * Items already being made or made (any status but "planned") are locked: they stay exactly as they
 * are whatever the draft says. The rest of the plan is replaced by the draft.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import type { PlanDraft } from "./brainstorm";
import type { CampaignRow, ItemState, LibraryClip } from "./store";

const { campaigns, campaignItems, conversations } = schema;

export const MAX_ITEMS = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

const str = (max: number) => z.string().transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max));

const itemSchema = z.object({
  number: z.number().int().nonnegative().catch(0),
  title: str(200).pipe(z.string().min(1)),
  angle: str(1000).catch(""),
  hook: str(500).catch(""),
  lengthSec: z.union([z.literal(15), z.literal(30), z.literal(60)]).catch(30),
  format: z.enum(["reel", "story"]).catch("reel"),
  music: str(500).catch(""),
  clips: z.array(z.string().max(20)).max(50).catch([]),
  postAt: z.string().max(60).catch(""),
});

const draftSchema = z.object({
  name: str(80).catch(""),
  theme: str(1000).catch(""),
  goal: str(1000).catch(""),
  audience: str(1000).catch(""),
  items: z.array(z.unknown()).max(200),
});

export interface ApplyResult {
  written: number;
  kept: number;
}

/** A time the draft gave, or (unreadable, or in the past) one day later per video from tomorrow 9:00 UTC-ish. */
function postTime(raw: string, index: number, now: Date): Date {
  const t = new Date(raw);
  if (raw && !Number.isNaN(t.getTime()) && t.getTime() > now.getTime()) return t;
  const base = new Date(now.getTime() + DAY_MS);
  base.setUTCHours(17, 0, 0, 0);
  return new Date(base.getTime() + index * DAY_MS);
}

export async function applyPlan(
  campaign: CampaignRow,
  draft: PlanDraft,
  states: ItemState[],
  library: LibraryClip[],
  now: Date = new Date(),
): Promise<ApplyResult | { error: string }> {
  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) return { error: "The plan didn't come out right." };
  const assetOf = new Map(library.map((c, i) => [`c${i + 1}`, c.assetId]));
  const locked = states.filter((s) => s.status !== "planned");
  const lockedNumbers = new Set(locked.map((s) => s.item.position));

  const fresh = parsed.data.items
    .map((raw) => itemSchema.safeParse(raw))
    .filter((r) => r.success)
    .map((r) => r.data!)
    .filter((d) => !(d.number > 0 && lockedNumbers.has(d.number)))
    .slice(0, Math.max(0, MAX_ITEMS - locked.length));
  if (fresh.length === 0 && locked.length === 0) return { error: "The plan had no videos in it." };

  type Row = { kept?: ItemState["item"]; values?: Omit<typeof campaignItems.$inferInsert, "position">; postAt: Date; order: number };
  const rows: Row[] = [
    ...locked.map((s, i) => ({ kept: s.item, postAt: s.item.postAt, order: i })),
    ...fresh.map((d, i) => {
      const postAt = postTime(d.postAt, i, now);
      const assetIds = [...new Set(d.clips.map((ref) => assetOf.get(ref.trim().toLowerCase())).filter((id): id is string => Boolean(id)))];
      return {
        postAt,
        order: locked.length + i,
        values: {
          campaignId: campaign.id,
          brandId: campaign.brandId,
          title: d.title,
          angle: d.angle,
          hook: d.hook,
          lengthSec: d.lengthSec,
          format: d.format,
          music: d.music,
          assetIds,
          postAt,
        },
      };
    }),
  ];
  // Numbered in posting order, so "#4" is the fourth to post.
  rows.sort((a, b) => a.postAt.getTime() - b.postAt.getTime() || a.order - b.order);

  const name = parsed.data.name || campaign.name;
  await db.transaction(async (tx) => {
    const replaced = states.filter((s) => s.status === "planned").map((s) => s.item.id);
    if (replaced.length > 0) await tx.delete(campaignItems).where(inArray(campaignItems.id, replaced));
    for (const [i, row] of rows.entries()) {
      if (row.kept) await tx.update(campaignItems).set({ position: i + 1, updatedAt: now }).where(eq(campaignItems.id, row.kept.id));
      else await tx.insert(campaignItems).values({ ...row.values!, position: i + 1 });
    }
    await tx
      .update(campaigns)
      .set({
        name,
        theme: parsed.data.theme || campaign.theme,
        goal: parsed.data.goal || campaign.goal,
        audience: parsed.data.audience || campaign.audience,
        planWrittenAt: campaign.planWrittenAt ?? now,
        updatedAt: now,
      })
      .where(eq(campaigns.id, campaign.id));
    // The chat takes the campaign's name; new uploads in it are filed in the library under it too.
    if (name) await tx.update(conversations).set({ title: name, updatedAt: now }).where(eq(conversations.id, campaign.conversationId));
  });
  return { written: fresh.length, kept: locked.length };
}
