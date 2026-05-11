import { withCronAuth } from "@/lib/cron/auth";
import { runResearchForAllBrands } from "@/lib/pipelines/research";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withCronAuth(async () => {
  return await runResearchForAllBrands();
});
