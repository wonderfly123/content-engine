import { withCronAuth } from "@/lib/cron/auth";
import { recomputePatternsForAllBrands } from "@/lib/pipelines/patterns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withCronAuth(async () => {
  return await recomputePatternsForAllBrands();
});
