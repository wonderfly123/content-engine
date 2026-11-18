/**
 * How long raw clips (the footage people upload) are kept once their thread is finished, set by the
 * platform admin in Admin > Storage. Finished means the thread is closed (posted, or replaced by a
 * new reel or story); clips in an open thread are never deleted, since the editor may still need them.
 * Finished videos, previews and other editor output are never touched.
 *
 * Default "forever": with no setting saved, nothing is deleted. The hourly cron
 * (app/api/cron/media-retention) deletes what is due: the object on R2, and `deleted_at` on the row
 * (so it stops counting against storage). Never logs file names.
 */
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { deleteObject } from "@/lib/storage/r2";

const { conversations, mediaObjects, platformSettings } = schema;

export const RAW_CLIP_RETENTION_KEY = "raw_clip_retention";

/** Days after the thread finishes; 0 = at the next hourly run; null = forever. */
export const RETENTION_OPTIONS = [
  { value: "after_post", label: "Right after posting", days: 0 },
  { value: "1d", label: "1 day", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "forever", label: "Forever", days: null },
] as const;

export type RetentionValue = (typeof RETENTION_OPTIONS)[number]["value"];
export const DEFAULT_RETENTION: RetentionValue = "forever";
export const isRetentionValue = (v: unknown): v is RetentionValue => RETENTION_OPTIONS.some((o) => o.value === v);

export async function getRawClipRetention(): Promise<RetentionValue> {
  const [row] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, RAW_CLIP_RETENTION_KEY)).limit(1);
  return isRetentionValue(row?.value) ? row.value : DEFAULT_RETENTION;
}

export async function setRawClipRetention(value: RetentionValue, userId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(platformSettings)
    .values({ key: RAW_CLIP_RETENTION_KEY, value, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: userId, updatedAt: now } });
}

const BATCH = 200;

export interface PurgeResult {
  retention: RetentionValue;
  deleted: number;
  failed: number;
}

/** Deletes the raw clips that are due under the current setting (at most 200 per run). */
export async function purgeExpiredRawClips(now: Date = new Date(), remove: (key: string) => Promise<void> = deleteObject): Promise<PurgeResult> {
  const retention = await getRawClipRetention();
  const days = RETENTION_OPTIONS.find((o) => o.value === retention)!.days;
  if (days === null) return { retention, deleted: 0, failed: 0 };

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const due = await db
    .select({ id: mediaObjects.id, r2Key: mediaObjects.r2Key })
    .from(mediaObjects)
    .innerJoin(conversations, eq(conversations.id, mediaObjects.conversationId))
    .where(
      and(
        eq(mediaObjects.kind, "raw"),
        inArray(mediaObjects.status, ["ready", "processing", "failed"]),
        isNull(mediaObjects.deletedAt),
        eq(conversations.status, "closed"),
        lte(conversations.closedAt, cutoff),
      ),
    )
    .limit(BATCH);

  let deleted = 0;
  let failed = 0;
  for (const clip of due) {
    try {
      await remove(clip.r2Key);
      await db.update(mediaObjects).set({ deletedAt: now, updatedAt: now }).where(eq(mediaObjects.id, clip.id));
      // Its library entry has nothing left to play: archive it.
      await db.update(schema.assets).set({ archived: true }).where(eq(schema.assets.mediaObjectId, clip.id));
      deleted++;
    } catch {
      failed++; // left as is; the next run tries again
    }
  }
  return { retention, deleted, failed };
}
