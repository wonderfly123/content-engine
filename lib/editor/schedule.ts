/**
 * Putting an approved cloud-editor cut on the posting calendar, from the server (no local files):
 * the counterpart of lib/reels/schedule.ts for cuts that live on R2.
 *
 *   scheduleEditorCut  -> asset (video at r2://<preview key>) -> brief -> draft -> post (queued);
 *                         the thread's `post_id` is set so "it's live" can find the conversation.
 *   cancelScheduledPost -> removes a post that has not started publishing.
 *   scheduledPostFor   -> the post already made for a job's cut, if any.
 *
 * A thread of kind "story" posts as an Instagram Story (format "story"); everything else as a Reel.
 * The video is the cut's preview on R2; the publish cron presigns it when it hands it to Instagram
 * (lib/storage/r2.ts resolveStorageUrl), so a post can wait any length of time. The cover is the
 * cut's `coverAt` (Instagram `thumb_offset`). The caller has already checked access to the thread.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { AccessError } from "@/lib/auth/workspace";
import type { ConversationAccess } from "@/lib/conversations/access";
import { db, schema } from "@/lib/db";
import { REEL_MODES, type ReelMode } from "@/lib/reels/schedule";
import { R2_URI_PREFIX } from "@/lib/storage/r2";
import type { EditorCut } from "./manifest";

const { assets, briefs, channelConnections, conversations, draftAssets, drafts, editorJobs, posts } = schema;

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

export interface ScheduleEditorCutInput {
  /** The thread the job belongs to (from requireConversation or an upload/watch link). */
  access: ConversationAccess;
  jobId: string;
  cutId: string;
  /** When to post; a time in the past or now means "as soon as the publish cron runs" (every minute). */
  when: Date;
  /** Reels only (Stories have no trial mode). Default "trial-manual", like the montage skill. */
  mode?: ReelMode;
}

export interface ScheduledEditorCut {
  postId: string;
  when: Date;
  format: "reel" | "story";
  title: string;
}

interface CutMeta {
  editorJobId: string;
  cutId: string;
  conversationId: string;
}

/** The post already made for this job's cut (still in our calendar, any status), or null. */
export async function scheduledPostFor(jobId: string, cutId: string): Promise<{ postId: string; status: string; when: Date } | null> {
  const [row] = await db
    .select({ postId: posts.id, status: posts.status, when: posts.scheduledFor })
    .from(posts)
    .innerJoin(drafts, eq(drafts.id, posts.draftId))
    .where(and(sql`${drafts.metaJson}->>'editorJobId' = ${jobId}`, sql`${drafts.metaJson}->>'cutId' = ${cutId}`))
    .limit(1);
  return row ?? null;
}

export async function scheduleEditorCut(input: ScheduleEditorCutInput): Promise<ScheduledEditorCut> {
  const { access, jobId, cutId } = input;
  const mode = input.mode ?? "trial-manual";
  if (!REEL_MODES.includes(mode)) throw new ScheduleError(`unknown mode ${mode}`);
  if (Number.isNaN(input.when.getTime())) throw new ScheduleError("Can't read the time to post.");
  const when = input.when.getTime() < Date.now() ? new Date() : input.when;

  const [job] = await db
    .select()
    .from(editorJobs)
    .where(and(eq(editorJobs.id, jobId), eq(editorJobs.conversationId, access.conversation.id), eq(editorJobs.workspaceId, access.workspaceId)))
    .limit(1);
  if (!job) throw new AccessError(404, "Not found.");
  if (job.status !== "approved") throw new ScheduleError("Approve the cut before scheduling it.");
  const cut: EditorCut | undefined = job.manifest?.cuts.find((c) => c.id === cutId);
  if (!cut) throw new AccessError(404, "Not found.");

  const brandId = access.conversation.brandId ?? job.brandId;
  if (!brandId) throw new ScheduleError("Choose a brand for this video first.");
  const [brand] = await db
    .select({ id: schema.brands.id, name: schema.brands.name })
    .from(schema.brands)
    .where(and(eq(schema.brands.id, brandId), eq(schema.brands.workspaceId, access.workspaceId)))
    .limit(1);
  if (!brand) throw new AccessError(404, "Not found.");
  const [conn] = await db
    .select({ status: channelConnections.status })
    .from(channelConnections)
    .where(and(eq(channelConnections.brandId, brand.id), eq(channelConnections.channel, "instagram")))
    .limit(1);
  if (!conn || conn.status !== "connected") throw new ScheduleError(`${brand.name} has no connected Instagram account.`);

  // Scheduling the same cut again moves the time instead of making a second post.
  const existing = await scheduledPostFor(jobId, cutId);
  const format = access.conversation.kind === "story" ? "story" : "reel";
  const title = conversationTitle(access.conversation) ?? cut.title;
  if (existing) {
    if (existing.status !== "queued") throw new ScheduleError(existing.status === "published" ? "This one is already posted." : "This one is already posting.");
    await db.update(posts).set({ scheduledFor: when, updatedAt: new Date() }).where(eq(posts.id, existing.postId));
    return { postId: existing.postId, when, format, title };
  }

  const meta: CutMeta & Record<string, unknown> = {
    title,
    editorJobId: job.id,
    cutId: cut.id,
    conversationId: access.conversation.id,
    coverAtMs: Math.round(Math.max(0, cut.coverAt) * 1000),
    trialReel: format === "story" || mode === "normal" ? null : mode === "trial-auto" ? "auto" : "manual",
  };

  return db.transaction(async (tx) => {
    const [asset] = await tx
      .insert(assets)
      .values({
        brandId: brand.id,
        kind: "video",
        label: title,
        tags: ["finished-cut", "cloud-editor"],
        storageUrl: `${R2_URI_PREFIX}${cut.preview.key}`,
        thumbnailUrl: null,
        durationSec: Math.round(cut.seconds),
        mimeType: "video/mp4",
        source: "uploaded",
        notes: `cloud editor job ${job.id}, cut ${cut.id}`,
      })
      .returning({ id: assets.id });
    const [brief] = await tx
      .insert(briefs)
      .values({
        brandId: brand.id,
        channel: "instagram",
        format,
        title,
        status: "approved",
        targetPublishDate: when.toISOString().slice(0, 10),
        reviewedAt: new Date(),
      })
      .returning({ id: briefs.id });
    const [draft] = await tx
      .insert(drafts)
      .values({ briefId: brief.id, brandId: brand.id, channel: "instagram", format, caption: cut.caption, status: "scheduled", reviewedAt: new Date(), metaJson: meta })
      .returning({ id: drafts.id });
    await tx.insert(draftAssets).values({ draftId: draft.id, assetId: asset.id, slotIndex: 0, role: "primary" });
    const [post] = await tx
      .insert(posts)
      .values({ draftId: draft.id, brandId: brand.id, channel: "instagram", status: "queued", scheduledFor: when })
      .returning({ id: posts.id });
    await tx.update(conversations).set({ postId: post.id, updatedAt: new Date() }).where(eq(conversations.id, access.conversation.id));
    return { postId: post.id, when, format, title };
  });
}

/**
 * Takes a post off the calendar if it has not started publishing (queued, or failed and waiting to
 * retry). The post row goes; its draft stays as a record (status "rejected", meta.cancelledAt).
 * Returns false when there is nothing to cancel in this workspace.
 */
export async function cancelScheduledPost(postId: string, workspaceId: string): Promise<boolean> {
  const [post] = await db
    .select({ id: posts.id, draftId: posts.draftId, status: posts.status, containerId: posts.externalContainerId })
    .from(posts)
    .innerJoin(schema.brands, eq(schema.brands.id, posts.brandId))
    .where(and(eq(posts.id, postId), eq(schema.brands.workspaceId, workspaceId)))
    .limit(1);
  if (!post || !["queued", "failed"].includes(post.status) || post.containerId) return false;
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(posts)
      .where(and(eq(posts.id, post.id), inArray(posts.status, ["queued", "failed"])))
      .returning({ id: posts.id });
    if (removed.length === 0) return;
    await tx
      .update(drafts)
      .set({ status: "rejected", metaJson: sql`${drafts.metaJson} || ${JSON.stringify({ cancelledAt: new Date().toISOString() })}::jsonb` })
      .where(eq(drafts.id, post.draftId));
  });
  return true;
}

/** The thread's own name, once threads have one (a `title` column); null until then. */
function conversationTitle(row: ConversationAccess["conversation"]): string | null {
  const title = (row as { title?: unknown }).title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}
