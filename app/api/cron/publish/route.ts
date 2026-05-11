import { withCronAuth } from "@/lib/cron/auth";
import { publishDuePosts } from "@/lib/pipelines/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro: 5 min for publish sweep

export const GET = withCronAuth(async () => {
  const result = await publishDuePosts({ limit: 20 });
  return result;
});
