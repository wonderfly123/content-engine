import { withCronAuth } from "@/lib/cron/auth";
import { publishDuePosts } from "@/lib/pipelines/publish";
// Registers the "it's live" text for posts made from a conversation.
import "@/lib/conversations/posted";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro: 5 min for publish sweep

export const GET = withCronAuth(async () => {
  const result = await publishDuePosts({ limit: 20 });
  return result;
});
