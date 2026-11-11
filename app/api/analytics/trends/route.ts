/**
 * GET /api/analytics/trends
 *
 * Returns three time series for the analytics page charts:
 *   - reach (split by channel when "All" is selected)
 *   - engagement rate (daily average)
 *   - follower growth (cumulative)
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchInstagramDailyNewFollowers } from "@/lib/publishing/meta-graph";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  buildEngagementTrend,
  buildFollowerTrend,
  buildReachTrend,
  buildViewsTrend,
  filterRows,
} from "@/lib/analytics/aggregate";
import { activeChannel, parseFilters, resolveRange } from "@/lib/analytics/filters";
import {
  loadEnabledChannels,
  loadFollowerSeries,
  loadLastSyncedAt,
  loadPostAggRows,
} from "@/lib/analytics/queries";

export const runtime = "nodejs";

const querySchema = z.object({ brandId: z.string().uuid() });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({ brandId: sp.get("brandId") });
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "invalid_query" } },
      { status: 400 },
    );
  }
  const { brandId } = parsed.data;
  const filters = parseFilters(sp);
  const { start, end } = resolveRange(filters);

  try {
    const enabledChannels = await loadEnabledChannels(brandId);
    const [rows, followerSeries, lastSyncedAt] = await Promise.all([
      loadPostAggRows(brandId, start, end, enabledChannels),
      loadFollowerSeries(brandId, start, end, activeChannel(filters)),
      loadLastSyncedAt(brandId),
    ]);
    const channel = activeChannel(filters);

    // Instagram keeps daily new-follower counts for 30 days; show as many of them as the window covers.
    let newFollowers: Array<{ date: string; newFollowers: number }> = [];
    if (channel === "instagram") {
      try {
        const [conn] = await db
          .select()
          .from(schema.channelConnections)
          .where(and(eq(schema.channelConnections.brandId, brandId), eq(schema.channelConnections.channel, "instagram")))
          .limit(1);
        const accountId = conn?.metaJson.igBusinessId ?? conn?.externalAccountId;
        if (conn && conn.status === "connected" && accountId) {
          newFollowers = await fetchInstagramDailyNewFollowers({ accountId, accessToken: conn.accessToken, days: filters.dateRange === "7d" ? 7 : 29 });
        }
      } catch {
        // The chart simply stays empty.
      }
    }
    const currentRows = filterRows(rows, { ...filters, channels: [channel] }, { start, end });
    const split = "all" as const;

    return NextResponse.json({
      data: {
        reach: buildReachTrend(currentRows, split),
        views: buildViewsTrend(currentRows),
        newFollowers,
        engagement: buildEngagementTrend(currentRows),
        followers: buildFollowerTrend(followerSeries),
        split,
        lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
      },
      error: null,
    });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { code: "query_failed", message: (err as Error).message } },
      { status: 500 },
    );
  }
}
