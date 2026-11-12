/**
 * Put a finished, approved video on the posting calendar as an Instagram Reel.
 * Scheduling IS the approval: the publish cron posts it at the scheduled time.
 *
 * Usage:
 *   npx tsx scripts/schedule-cut.ts <brand-slug> <video.mp4> <caption | caption.txt> "<when>" <cover-seconds> [trial-manual|trial-auto|normal] ["<title>"]
 *   <cover-seconds> is the frame the user confirmed as the cover (thumbnail), in seconds into the video.
 *   <when> is anything Date can parse in local time, e.g. "2026-11-12 09:00".
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

async function main(): Promise<void> {
  loadEnv({ path: ".env.local", quiet: true });
  const { scheduleCut, REEL_MODES } = await import("@/lib/reels/schedule");
  const [, , slug, videoArg, captionArg, whenArg, coverArg, modeArg = "trial-manual", title] = process.argv;
  const mode = REEL_MODES.find((m) => m === modeArg);
  const coverAt = Number(coverArg);
  if (!slug || !videoArg || !captionArg || !whenArg || !mode || !coverArg || !Number.isFinite(coverAt)) {
    console.error('Usage: schedule-cut.ts <brand-slug> <video.mp4> <caption | caption.txt> "<when>" <cover-seconds> [trial-manual|trial-auto|normal] ["<title>"]');
    process.exit(1);
  }
  const caption = existsSync(captionArg) ? readFileSync(captionArg, "utf8") : captionArg;
  const done = await scheduleCut({ brandSlug: slug, video: resolve(videoArg), caption, when: new Date(whenArg), mode, coverAt, title });
  console.log(`scheduled "${done.title}" for ${done.when.toLocaleString()} on ${done.brandName} Instagram (${mode})`);
  console.log(`post ${done.postId}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error((err as Error).message); process.exit(1); });
