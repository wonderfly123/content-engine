import { withCronAuth } from "@/lib/cron/auth";
import { checkConnections } from "@/lib/connections/check";
import { checkCredentials } from "@/lib/credentials/check";
import { recoverStuckOptimizing } from "@/lib/media/optimize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withCronAuth(async () => {
  const results = await checkConnections();
  const keys = await checkCredentials();
  // Clips the optimizer never answered for within 2 hours: kept as uploaded.
  const clipsRecovered = await recoverStuckOptimizing();
  return { checked: results.length, active: results.filter((r) => r.status === "connected").length, keysChecked: keys.checked, keysFailing: keys.failing, clipsRecovered };
});
