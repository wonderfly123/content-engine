import { withCronAuth } from "@/lib/cron/auth";
import { ingestAds } from "@/lib/pipelines/ads";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () => {
  return await ingestAds();
});
