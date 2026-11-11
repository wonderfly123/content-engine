/**
 * Put a finished, approved video on the posting calendar as an Instagram Reel.
 * Scheduling IS the approval: the publish cron posts it at the scheduled time.
 *
 * Hosts the video (and a thumbnail) on the public Vercel Blob store so Instagram can
 * fetch it, then creates asset -> brief -> draft -> post (queued).
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const REEL_MODES = ["trial-manual", "trial-auto", "normal"] as const;
export type ReelMode = (typeof REEL_MODES)[number];

export interface ScheduleCutInput {
  brandSlug: string;
  /** Absolute path to the finished video on this machine. */
  video: string;
  caption: string;
  when: Date;
  mode: ReelMode;
  title?: string;
}

export interface ScheduledCut {
  postId: string;
  brandName: string;
  title: string;
  when: Date;
}

export async function scheduleCut(input: ScheduleCutInput): Promise<ScheduledCut> {
  const { brandSlug, video, mode, when } = input;
  const caption = input.caption.trim();
  if (!existsSync(video) || !/\.(mp4|mov)$/i.test(video)) throw new Error(`not a video file: ${video}`);
  if (!caption) throw new Error("caption is empty");
  if (Number.isNaN(when.getTime())) throw new Error("cannot read the scheduled time");
  if (when.getTime() < Date.now() + 60_000) throw new Error("the scheduled time is in the past; scheduled posts publish as soon as they are due");
  if (!REEL_MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
  if (!process.env.BLOB_READ_WRITE_TOKEN?.startsWith("vercel_blob_rw_")) throw new Error("BLOB_READ_WRITE_TOKEN is not set in .env.local");

  const probe = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", video], { encoding: "utf8" }),
  ) as { streams: Array<{ width: number; height: number }>; format: { duration: string } };
  const { width, height } = probe.streams[0];
  const durationSec = Math.round(Number(probe.format.duration));
  const thumb = join(mkdtempSync(join(tmpdir(), "cut-")), "thumb.jpg");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", video, "-frames:v", "1", "-vf", "scale=540:-2", thumb]);

  const { db, schema } = await import("@/lib/db");
  const { and, eq } = await import("drizzle-orm");
  const { put } = await import("@vercel/blob");

  const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.slug, brandSlug)).limit(1);
  if (!brand) throw new Error(`no brand with slug "${brandSlug}"`);
  const [conn] = await db
    .select({ status: schema.channelConnections.status })
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.brandId, brand.id), eq(schema.channelConnections.channel, "instagram")))
    .limit(1);
  if (!conn || conn.status !== "connected") throw new Error(`brand "${brandSlug}" has no connected Instagram account`);

  const title = input.title ?? basename(video).replace(/\.[^.]+$/, "");
  const stem = `${brandSlug}/${title.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()}`;
  const size = statSync(video).size;
  const hosted = await put(`reels/${stem}.mp4`, createReadStream(video), { access: "public", addRandomSuffix: true, contentType: "video/mp4", multipart: true });
  const hostedThumb = await put(`reels/${stem}.jpg`, readFileSync(thumb), { access: "public", addRandomSuffix: true, contentType: "image/jpeg" });

  const [asset] = await db.insert(schema.assets).values({
    brandId: brand.id, kind: "video", label: title, tags: ["finished-cut"], storageUrl: hosted.url, thumbnailUrl: hostedThumb.url,
    durationSec, width, height, mimeType: "video/mp4", sizeBytes: size, source: "uploaded", notes: `from ${video}`,
  }).returning({ id: schema.assets.id });
  const [brief] = await db.insert(schema.briefs).values({
    brandId: brand.id, channel: "instagram", format: "reel", title, status: "approved",
    targetPublishDate: when.toISOString().slice(0, 10), reviewedAt: new Date(),
  }).returning({ id: schema.briefs.id });
  const [draft] = await db.insert(schema.drafts).values({
    briefId: brief.id, brandId: brand.id, channel: "instagram", format: "reel", caption, status: "scheduled", reviewedAt: new Date(),
    metaJson: { title, trialReel: mode === "normal" ? null : mode === "trial-auto" ? "auto" : "manual", sourceFile: video },
  }).returning({ id: schema.drafts.id });
  await db.insert(schema.draftAssets).values({ draftId: draft.id, assetId: asset.id, slotIndex: 0, role: "primary" });
  const [post] = await db.insert(schema.posts).values({
    draftId: draft.id, brandId: brand.id, channel: "instagram", status: "queued", scheduledFor: when,
  }).returning({ id: schema.posts.id });

  return { postId: post.id, brandName: brand.name, title, when };
}
