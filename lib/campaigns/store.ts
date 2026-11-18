/**
 * Reading a campaign, its plan items, where each item stands, and the brand's clip library. No access
 * checks here: callers have proved who is asking (requireConversation), and every query is scoped by
 * the conversation and workspace that check returned.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { ConversationRow } from "@/lib/conversations/store";
import { db, schema } from "@/lib/db";
import type { EditorManifest } from "@/lib/editor/manifest";
import { scheduledPostFor } from "@/lib/editor/schedule";

const { assets, brands, campaigns, campaignItems, editorJobs, mediaObjects } = schema;

export type CampaignRow = typeof campaigns.$inferSelect;
export type CampaignItemRow = typeof campaignItems.$inferSelect;
export type MediaRow = typeof mediaObjects.$inferSelect;

export const ITEM_STATUSES = ["planned", "editing", "ready", "approved", "scheduled", "posted"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface ItemState {
  item: CampaignItemRow;
  status: ItemStatus;
  /** The job that decides the status (the newest in flight, else the newest with cuts), if any. */
  jobId: string | null;
  /** The editor asked a question and has no cut yet: the person's next message answers it. */
  waitingForAnswer: boolean;
  /** The newest finished cut's manifest (a revision starts from it). */
  manifest: EditorManifest | null;
  post: { postId: string; status: string; when: Date } | null;
}

export async function campaignFor(thread: Pick<ConversationRow, "id" | "workspaceId">): Promise<CampaignRow | null> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.conversationId, thread.id), eq(campaigns.workspaceId, thread.workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function planItems(campaignId: string): Promise<CampaignItemRow[]> {
  return db.select().from(campaignItems).where(eq(campaignItems.campaignId, campaignId)).orderBy(asc(campaignItems.position));
}

/** Every item with its status, in plan order. */
export async function itemStates(campaign: CampaignRow): Promise<ItemState[]> {
  const items = await planItems(campaign.id);
  if (items.length === 0) return [];
  const jobs = await db
    .select()
    .from(editorJobs)
    .where(and(inArray(editorJobs.campaignItemId, items.map((i) => i.id)), eq(editorJobs.conversationId, campaign.conversationId)))
    .orderBy(desc(editorJobs.createdAt));
  const out: ItemState[] = [];
  for (const item of items) {
    const mine = jobs.filter((j) => j.campaignItemId === item.id);
    const live = mine.find((j) => j.status === "queued" || j.status === "running");
    const withCuts = mine.find((j) => (j.status === "done" || j.status === "approved") && (j.manifest?.cuts.length ?? 0) > 0);
    const newest = mine.find((j) => j.status !== "failed");
    const question = !live && newest?.status === "done" && !newest.manifest?.cuts.length ? newest : null;
    let status: ItemStatus = "planned";
    let post: ItemState["post"] = null;
    if (live || question) status = "editing";
    else if (withCuts) {
      post = await scheduledPostFor(withCuts.id, withCuts.manifest!.cuts[0].id);
      status =
        post?.status === "published" ? "posted" : post && post.status !== "rejected" ? "scheduled" : withCuts.status === "approved" ? "approved" : "ready";
    }
    out.push({
      item,
      status,
      jobId: (live ?? question ?? withCuts)?.id ?? null,
      waitingForAnswer: Boolean(question),
      manifest: withCuts?.manifest ?? null,
      post,
    });
  }
  return out;
}

/** The one item being made or waiting for approval (one at a time), if any. */
export const activeItem = (states: ItemState[]) => states.find((s) => s.status === "editing" || s.status === "ready") ?? null;
/** The next item to make: the first still planned. */
export const nextPlanned = (states: ItemState[]) => states.find((s) => s.status === "planned") ?? null;

export interface LibraryClip {
  assetId: string;
  label: string;
  description: string | null;
  tags: string[];
  durationSec: number | null;
}

/**
 * The brand's footage the editor can use: its library clips that are raw uploads still on storage,
 * newest first. Only the same workspace and brand, however the asset row says otherwise.
 */
export async function brandLibrary(brandId: string, workspaceId: string, limit = 300): Promise<LibraryClip[]> {
  const rows = await db
    .select({ assetId: assets.id, label: assets.label, description: assets.description, tags: assets.tags, durationSec: assets.durationSec })
    .from(assets)
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .innerJoin(mediaObjects, eq(mediaObjects.id, assets.mediaObjectId))
    .where(
      and(
        eq(assets.brandId, brandId),
        eq(brands.workspaceId, workspaceId),
        eq(assets.archived, false),
        isNotNull(assets.mediaObjectId),
        eq(mediaObjects.workspaceId, workspaceId),
        eq(mediaObjects.brandId, brandId),
        eq(mediaObjects.kind, "raw"),
        isNull(mediaObjects.deletedAt),
      ),
    )
    .orderBy(desc(assets.createdAt))
    .limit(limit);
  return rows;
}

/**
 * The media rows behind chosen library clips, ready to send to the worker. Only clips of this very
 * workspace and brand survive: an id from anywhere else is dropped, never sent.
 */
export async function libraryMedia(assetIds: string[], brandId: string, workspaceId: string): Promise<MediaRow[]> {
  const ids = [...new Set(assetIds.map((id) => id.toLowerCase()).filter((id) => /^[0-9a-f-]{36}$/.test(id)))];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ media: mediaObjects })
    .from(assets)
    .innerJoin(brands, eq(brands.id, assets.brandId))
    .innerJoin(mediaObjects, eq(mediaObjects.id, assets.mediaObjectId))
    .where(
      and(
        inArray(assets.id, ids),
        eq(assets.brandId, brandId),
        eq(brands.workspaceId, workspaceId),
        eq(mediaObjects.workspaceId, workspaceId),
        eq(mediaObjects.brandId, brandId),
        eq(mediaObjects.kind, "raw"),
        eq(mediaObjects.status, "ready"),
        isNull(mediaObjects.deletedAt),
      ),
    );
  return rows.map((r) => r.media);
}

/** The campaign chat's own uploaded clips that are ready (used when an item names no library clips). */
export async function threadClips(conversationId: string, workspaceId: string): Promise<MediaRow[]> {
  return db
    .select()
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.conversationId, conversationId),
        eq(mediaObjects.workspaceId, workspaceId),
        eq(mediaObjects.kind, "raw"),
        eq(mediaObjects.status, "ready"),
        isNull(mediaObjects.deletedAt),
      ),
    )
    .orderBy(asc(mediaObjects.createdAt));
}
