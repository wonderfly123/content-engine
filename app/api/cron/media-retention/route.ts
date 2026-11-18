import { withCronAuth } from "@/lib/cron/auth";
import { purgeExpiredRawClips } from "@/lib/media/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hourly: deletes raw clips that are due under Admin > Storage (lib/media/retention.ts). Nothing while it is "Forever". */
export const GET = withCronAuth(async () => purgeExpiredRawClips());
