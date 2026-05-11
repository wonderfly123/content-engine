import { withCronAuth } from "@/lib/cron/auth";
import { requeueFailedPosts } from "@/lib/pipelines/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Re-queues failed posts whose exponential-backoff window has elapsed
 * (1min / 5min / 30min from `last_error_at` for attempts 1/2/3). Posts that
 * exceed PUBLISH_MAX_ATTEMPTS stay terminal-failed and surface in alerts.
 *
 * In the future this handler will also drain other failed `jobs` rows.
 */
export const GET = withCronAuth(async () => {
  return await requeueFailedPosts();
});
