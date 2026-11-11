/**
 * Brings every post the Instagram account has ever published into the app as a published post,
 * so analytics cover the whole account and not only what the engine itself posted.
 * Safe to run repeatedly: posts already known (by Instagram media id) are skipped.
 */
import { and, eq, inArray } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db as defaultDb, schema } from "@/lib/db";
import {
  fetchInstagramPostInsights,
  listInstagramMedia,
  type InstagramMediaItem,
} from "@/lib/publishing/meta-graph";

type Db = typeof defaultDb;

export interface SyncResult {
  brandId: string;
  found: number;
  imported: number;
  failed: number;
}

function formatOf(m: InstagramMediaItem): "reel" | "carousel" | "image" | "story" | "post" {
  if (m.productType === "REELS") return "reel";
  if (m.productType === "STORY") return "story";
  if (m.mediaType === "CAROUSEL_ALBUM") return "carousel";
  if (m.mediaType === "IMAGE") return "image";
  return "post";
}

function titleOf(m: InstagramMediaItem): string {
  const firstLine = m.caption.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  if (!firstLine) return `Instagram ${formatOf(m)} ${m.timestamp.slice(0, 10)}`;
  return firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine;
}

/** Instagram's image URLs expire; keep our own copy for thumbnails. Null when it cannot be copied. */
async function keepThumbnail(m: InstagramMediaItem, brandSlug: string): Promise<string | null> {
  if (!m.imageUrl || !process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const res = await fetch(m.imageUrl);
    if (!res.ok) return null;
    const saved = await put(`thumbs/${brandSlug}/${m.id}.jpg`, Buffer.from(await res.arrayBuffer()), {
      access: "public",
      addRandomSuffix: true,
      contentType: res.headers.get("content-type") ?? "image/jpeg",
    });
    return saved.url;
  } catch {
    return null;
  }
}

export async function syncInstagramMedia(brandId: string, db: Db = defaultDb): Promise<SyncResult> {
  const [conn] = await db
    .select()
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.brandId, brandId), eq(schema.channelConnections.channel, "instagram")))
    .limit(1);
  if (!conn || conn.status !== "connected") return { brandId, found: 0, imported: 0, failed: 0 };
  const accountId = conn.metaJson.igBusinessId ?? conn.externalAccountId;
  if (!accountId) return { brandId, found: 0, imported: 0, failed: 0 };
  const [brand] = await db.select({ slug: schema.brands.slug }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);

  const media = (await listInstagramMedia({ accountId, accessToken: conn.accessToken })).filter((m) => m.productType !== "STORY");
  if (media.length === 0) return { brandId, found: 0, imported: 0, failed: 0 };

  const known = new Set(
    (
      await db
        .select({ externalPostId: schema.posts.externalPostId })
        .from(schema.posts)
        .where(and(eq(schema.posts.brandId, brandId), inArray(schema.posts.externalPostId, media.map((m) => m.id))))
    ).map((r) => r.externalPostId),
  );

  let imported = 0;
  let failed = 0;
  for (const m of media) {
    if (known.has(m.id)) continue;
    try {
      const publishedAt = new Date(m.timestamp);
      const format = formatOf(m);
      const title = titleOf(m);
      const thumbnailUrl = await keepThumbnail(m, brand?.slug ?? "brand");

      const [brief] = await db
        .insert(schema.briefs)
        .values({ brandId, channel: "instagram", format, title, status: "approved", targetPublishDate: m.timestamp.slice(0, 10), reviewedAt: publishedAt })
        .returning({ id: schema.briefs.id });
      const [draft] = await db
        .insert(schema.drafts)
        .values({ briefId: brief.id, brandId, channel: "instagram", format, caption: m.caption, status: "scheduled", reviewedAt: publishedAt, metaJson: { title, importedFrom: "instagram" } })
        .returning({ id: schema.drafts.id });
      const [asset] = await db
        .insert(schema.assets)
        .values({
          brandId,
          kind: m.mediaType === "VIDEO" ? "video" : "image",
          label: title,
          tags: ["imported"],
          storageUrl: m.permalink,
          thumbnailUrl,
          source: "imported_from_post",
          notes: "Published on Instagram outside the engine; the media itself is not stored.",
        })
        .returning({ id: schema.assets.id });
      await db.insert(schema.draftAssets).values({ draftId: draft.id, assetId: asset.id, slotIndex: 0, role: "primary" });
      const [post] = await db
        .insert(schema.posts)
        .values({ draftId: draft.id, brandId, channel: "instagram", status: "published", scheduledFor: publishedAt, publishedAt, externalPostId: m.id, externalUrl: m.permalink })
        .returning({ id: schema.posts.id });

      // First numbers straight away, so the post is not blank until the next scheduled pull.
      try {
        const snap = await fetchInstagramPostInsights({ externalPostId: m.id, accessToken: conn.accessToken });
        await db.insert(schema.analyticsSnapshots).values({
          postId: post.id,
          brandId,
          reach: snap.reach ?? null,
          impressions: snap.impressions ?? null,
          likes: snap.likes ?? null,
          comments: snap.comments ?? null,
          shares: snap.shares ?? null,
          saves: snap.saves ?? null,
          watchTimeSec: snap.watch_time_sec ?? null,
          videoViews: snap.video_views ?? null,
          profileVisits: snap.profile_visits ?? null,
          followsFromPost: snap.follows_from_post ?? null,
          rawJson: (snap.raw_json as Record<string, unknown>) ?? {},
        });
      } catch {
        // Very old posts (before the account was professional) have no insights. The post still imports.
      }
      imported++;
    } catch (err) {
      failed++;
      console.error(`[sync-instagram] ${m.id} failed: ${(err as Error).message}`);
    }
  }
  return { brandId, found: media.length, imported, failed };
}

/** Sync every brand that has a connected Instagram account. */
export async function syncAllInstagramMedia(db: Db = defaultDb): Promise<SyncResult[]> {
  const conns = await db
    .select({ brandId: schema.channelConnections.brandId })
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.channel, "instagram"), eq(schema.channelConnections.status, "connected")));
  const out: SyncResult[] = [];
  for (const c of conns) out.push(await syncInstagramMedia(c.brandId, db));
  return out;
}
