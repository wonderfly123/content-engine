/**
 * How long raw clips (the footage people upload) are kept once their thread is finished. Set per brand
 * in Settings > Storage (`brands.settings_json.rawClipRetention`); a brand with no choice of its own
 * falls back to the platform value (`platform_settings.raw_clip_retention`), then to "forever".
 * Clips whose thread has no brand use the platform value.
 *
 * Finished means the thread is closed (posted, or replaced by a new reel or story); clips in an open
 * thread are never deleted, since the editor may still need them. Finished videos, previews and other
 * editor output are never touched.
 *
 * Default "forever": with nothing saved, nothing is deleted. The hourly cron
 * (app/api/cron/media-retention) deletes what is due: the object on R2, and `deleted_at` on the row
 * (so it stops counting against storage). Never logs file names.
 */
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { deleteObject } from "@/lib/storage/r2";

const { brands, conversations, mediaObjects, platformSettings } = schema;

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

/** The platform-wide fallback, for brands with no choice of their own and for brandless threads. */
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

/** The brand's own choice, if it has made one. */
function brandChoice(settings: unknown): RetentionValue | null {
  const v = settings && typeof settings === "object" ? (settings as Record<string, unknown>).rawClipRetention : undefined;
  return isRetentionValue(v) ? v : null;
}

/** The brand's effective retention: its own choice, else the platform value, else "forever". */
export async function getBrandRetention(brandId: string): Promise<RetentionValue> {
  const [row] = await db.select({ settings: brands.settingsJson }).from(brands).where(eq(brands.id, brandId)).limit(1);
  return brandChoice(row?.settings) ?? (await getRawClipRetention());
}

/**
 * Saves the brand's choice on `settings_json.rawClipRetention`, merged in one statement so other keys
 * are kept. `userId` is the member who changed it (the brand row has no field for it today).
 */
export async function setBrandRetention(brandId: string, value: RetentionValue, userId: string): Promise<void> {
  void userId;
  if (!isRetentionValue(value)) throw new Error("invalid retention value");
  await db
    .update(brands)
    .set({
      settingsJson: sql`coalesce(${brands.settingsJson}, '{}'::jsonb) || jsonb_build_object('rawClipRetention', ${value}::text)`,
      updatedAt: new Date(),
    })
    .where(eq(brands.id, brandId));
}

const BATCH = 200;

export interface PurgeResult {
  /** The platform fallback in force for this run (brands may choose their own). */
  platformRetention: RetentionValue;
  deleted: number;
  failed: number;
}

/**
 * Deletes the raw clips that are due, each under its brand's effective retention (brandless threads
 * use the platform value). At most 200 per run.
 */
export async function purgeExpiredRawClips(now: Date = new Date(), remove: (key: string) => Promise<void> = deleteObject): Promise<PurgeResult> {
  const platformRetention = await getRawClipRetention();

  // The brand's own valid choice, else the platform value.
  const own = sql`(${brands.settingsJson} ->> 'rawClipRetention')`;
  const known = sql.join(
    RETENTION_OPTIONS.map((o) => sql`${o.value}`),
    sql`, `,
  );
  const effective = sql`coalesce(case when ${own} in (${known}) then ${own} end, ${platformRetention}::text)`;
  // Due once the thread closed before that retention's cutoff; "forever" is never due.
  const whens: SQL[] = RETENTION_OPTIONS.flatMap((o) => {
    if (o.days === null) return [];
    const cutoff = new Date(now.getTime() - o.days * 24 * 60 * 60 * 1000).toISOString();
    return [sql`when ${o.value} then ${conversations.closedAt} <= ${cutoff}::timestamptz`];
  });
  const isDue = sql`(case ${effective} ${sql.join(whens, sql` `)} else false end)`;

  const due = await db
    .select({ id: mediaObjects.id, r2Key: mediaObjects.r2Key })
    .from(mediaObjects)
    .innerJoin(conversations, eq(conversations.id, mediaObjects.conversationId))
    .leftJoin(brands, eq(brands.id, conversations.brandId))
    .where(
      and(
        eq(mediaObjects.kind, "raw"),
        inArray(mediaObjects.status, ["ready", "processing", "failed"]),
        isNull(mediaObjects.deletedAt),
        eq(conversations.status, "closed"),
        isDue,
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
  return { platformRetention, deleted, failed };
}
