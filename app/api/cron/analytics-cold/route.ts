import { withCronAuth } from "@/lib/cron/auth";
import { syncAllInstagramMedia } from "@/lib/analytics/sync-instagram";
import { pullAnalyticsCold } from "@/lib/pipelines/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () => {
  // Pick up anything published directly in the Instagram app, then refresh older posts and follower counts.
  const synced = await syncAllInstagramMedia();
  const pulled = await pullAnalyticsCold();
  return { ...pulled, imported: synced.reduce((n, s) => n + s.imported, 0) };
});
