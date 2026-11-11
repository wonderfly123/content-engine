/**
 * Verifies each Instagram / Facebook connection against the Graph API and
 * records the result. Run hourly by /api/cron/connections and on demand from Admin.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const GRAPH = "https://graph.facebook.com/v27.0";

export interface ConnectionStatus {
  id: string;
  brandId: string;
  brandName: string;
  brandSlug: string;
  channel: string;
  status: "connected" | "expired" | "revoked" | "error";
  accountName: string | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
}

type Row = typeof schema.channelConnections.$inferSelect;

function toStatus(row: Row, brand: { name: string; slug: string }): ConnectionStatus {
  return {
    id: row.id,
    brandId: row.brandId,
    brandName: brand.name,
    brandSlug: brand.slug,
    channel: row.channel,
    status: row.status,
    accountName: (row.metaJson.accountName as string | undefined) ?? null,
    lastCheckedAt: (row.metaJson.lastCheckedAt as string | undefined) ?? null,
    lastCheckError: (row.metaJson.lastCheckError as string | undefined) ?? null,
  };
}

async function loadRows(): Promise<Array<{ row: Row; brand: { name: string; slug: string } }>> {
  const rows = await db
    .select({ row: schema.channelConnections, name: schema.brands.name, slug: schema.brands.slug })
    .from(schema.channelConnections)
    .innerJoin(schema.brands, eq(schema.channelConnections.brandId, schema.brands.id));
  return rows
    .filter((r) => r.row.channel === "instagram" || r.row.channel === "facebook")
    .map((r) => ({ row: r.row, brand: { name: r.name, slug: r.slug } }));
}

export async function listConnections(): Promise<ConnectionStatus[]> {
  return (await loadRows()).map(({ row, brand }) => toStatus(row, brand));
}

export async function checkConnections(fetchImpl: typeof fetch = fetch): Promise<ConnectionStatus[]> {
  const out: ConnectionStatus[] = [];
  for (const { row, brand } of await loadRows()) {
    const accountId = row.channel === "instagram" ? (row.metaJson.igBusinessId ?? row.externalAccountId) : (row.metaJson.fbPageId ?? row.externalAccountId);
    const field = row.channel === "instagram" ? "username" : "name";
    let status: Row["status"] = row.status;
    let accountName = (row.metaJson.accountName as string | undefined) ?? null;
    let lastCheckError: string | null = null;
    try {
      const res = await fetchImpl(`${GRAPH}/${accountId}?fields=${field}&access_token=${encodeURIComponent(row.accessToken)}`);
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number; type?: string } };
      if (res.ok && typeof json[field] === "string") {
        status = "connected";
        accountName = row.channel === "instagram" ? `@${json[field]}` : (json[field] as string);
      } else {
        // Token problems change the status; anything else (outage, rate limit) only records the error.
        if (json.error?.code === 190 || json.error?.type === "OAuthException") status = "expired";
        lastCheckError = json.error?.message ?? `Graph API ${res.status}`;
      }
    } catch (err) {
      lastCheckError = `could not reach Meta: ${(err as Error).message}`;
    }
    const metaJson = { ...row.metaJson, accountName, lastCheckedAt: new Date().toISOString(), lastCheckError };
    await db.update(schema.channelConnections).set({ status, metaJson }).where(eq(schema.channelConnections.id, row.id));
    out.push(toStatus({ ...row, status, metaJson }, brand));
  }
  return out;
}
