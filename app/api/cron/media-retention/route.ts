import { withCronAuth } from "@/lib/cron/auth";
import { purgeExpiredRawClips } from "@/lib/media/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hourly: deletes raw clips that are due under each brand's Settings > Storage choice, else the platform value (lib/media/retention.ts). */
export const GET = withCronAuth(async () => purgeExpiredRawClips());
