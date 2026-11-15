/**
 * Hourly health check for stored keys (run by /api/cron/connections, next to the Instagram /
 * Facebook check). A key the service rejects is marked "failing"; an outage only records the error.
 * One workspace's failure never stops the others.
 */
import { db, schema } from "@/lib/db";
import { recordCredentialCheck } from "./store";
import { verifyCredential } from "./verify";

export async function checkCredentials(fetchImpl: typeof fetch = fetch): Promise<{ checked: number; failing: number }> {
  const rows = await db.select().from(schema.workspaceCredentials);
  let failing = 0;
  for (const row of rows) {
    try {
      const result = await verifyCredential(row.provider, row.secret, fetchImpl);
      if (result.ok) await recordCredentialCheck(row.workspaceId, row.provider, null);
      else if (result.rejected) {
        failing++;
        await recordCredentialCheck(row.workspaceId, row.provider, result.error);
      }
      // Not rejected and not ok: the service was unreachable. Leave the status as it was.
    } catch (err) {
      console.error(`credential check failed for workspace ${row.workspaceId} ${row.provider}:`, err);
    }
  }
  return { checked: rows.length, failing };
}
