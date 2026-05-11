import { withCronAuth } from "@/lib/cron/auth";
import { pullAnalyticsHot } from "@/lib/pipelines/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withCronAuth(async () => {
  return await pullAnalyticsHot();
});
