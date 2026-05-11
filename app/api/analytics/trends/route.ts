/**
 * GET /api/analytics/trends
 *
 * Returns three time series for the analytics page charts:
 *   - reach (split by channel when "All" is selected)
 *   - engagement rate (daily average)
 *   - follower growth (cumulative)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  buildEngagementTrend,
  buildFollowerTrend,
  buildReachTrend,
  filterRows,
} from "@/lib/analytics/aggregate";
import { parseFilters, resolveRange } from "@/lib/analytics/filters";
import {
  loadFollowerSeries,
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
    const [rows, followerSeries] = await Promise.all([
      loadPostAggRows(brandId, start, end),
      loadFollowerSeries(brandId, start, end),
    ]);
    const currentRows = filterRows(rows, filters, { start, end });
    const split: "all" | "channel" = filters.channels.length === 0 ? "channel" : "all";

    return NextResponse.json({
      data: {
        reach: buildReachTrend(currentRows, split),
        engagement: buildEngagementTrend(currentRows),
        followers: buildFollowerTrend(followerSeries),
        split,
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
