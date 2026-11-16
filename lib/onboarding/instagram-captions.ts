/**
 * Recent captions from the brand's connected Instagram account, read through the Graph API code the
 * analytics sync uses. Never scrapes instagram.com. Empty when nothing is connected or the read fails.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channelConnections } from "@/lib/db/schema";
import { listInstagramMedia } from "@/lib/publishing/meta-graph";

export async function hasInstagramConnection(brandId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: channelConnections.id })
    .from(channelConnections)
    .where(and(eq(channelConnections.brandId, brandId), eq(channelConnections.channel, "instagram"), eq(channelConnections.status, "connected")))
    .limit(1);
  return Boolean(row);
}

export async function recentInstagramCaptions(brandId: string, max = 8): Promise<string[]> {
  try {
    const [conn] = await db
      .select({ accountId: channelConnections.externalAccountId, accessToken: channelConnections.accessToken })
      .from(channelConnections)
      .where(and(eq(channelConnections.brandId, brandId), eq(channelConnections.channel, "instagram"), eq(channelConnections.status, "connected")))
      .limit(1);
    if (!conn?.accountId || !conn.accessToken) return [];
    const media = await listInstagramMedia({ accountId: conn.accountId, accessToken: conn.accessToken, maxItems: 30 });
    return media
      .filter((m) => m.productType !== "STORY")
      .map((m) => m.caption.trim())
      .filter((c) => c.length > 0)
      .slice(0, max)
      .map((c) => c.slice(0, 2200));
  } catch {
    return [];
  }
}
