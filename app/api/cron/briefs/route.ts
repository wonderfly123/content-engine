import { withCronAuth } from "@/lib/cron/auth";
import { runBriefBatchForAllBrands } from "@/lib/pipelines/briefs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withCronAuth(async () => {
  return await runBriefBatchForAllBrands();
});
