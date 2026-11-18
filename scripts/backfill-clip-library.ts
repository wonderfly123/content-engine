/**
 * Files every clip uploaded before the Assets library took them in automatically, and has each one
 * described and tagged by AI (lib/media/describe.ts). Safe to run again: a clip already in the
 * library is skipped. Callbacks go to APP_URL, so run it against the deployed app.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-clip-library.ts [--retag]
 *     --retag  also re-describes library clips whose description failed
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addClipToLibrary, requestDescribe } from "@/lib/media/describe";

const { assets, mediaObjects } = schema;

async function main() {
  const origin = process.env.APP_URL?.trim();
  if (!origin) throw new Error("Set APP_URL (the deployed app) so the worker can call back.");
  const clips = await db
    .select({ m: mediaObjects })
    .from(mediaObjects)
    .leftJoin(assets, eq(assets.mediaObjectId, mediaObjects.id))
    .where(and(eq(mediaObjects.kind, "raw"), eq(mediaObjects.status, "ready"), isNull(mediaObjects.deletedAt), isNotNull(mediaObjects.brandId), isNull(assets.id)));
  let filed = 0;
  for (const { m } of clips) if (await addClipToLibrary(m, origin)) filed++;
  console.log(`Filed ${filed} of ${clips.length} clips in the library.`);

  if (process.argv.includes("--retag")) {
    const failed = await db.select({ id: assets.id }).from(assets).where(and(isNotNull(assets.mediaObjectId), eq(assets.describeStatus, "failed")));
    for (const a of failed) await requestDescribe(a.id, origin);
    console.log(`Asked again for ${failed.length} descriptions.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
