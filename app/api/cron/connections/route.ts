import { withCronAuth } from "@/lib/cron/auth";
import { checkConnections } from "@/lib/connections/check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withCronAuth(async () => {
  const results = await checkConnections();
  return { checked: results.length, active: results.filter((r) => r.status === "connected").length };
});
