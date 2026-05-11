/**
 * GET /api/analytics/topline
 *
 * Returns 6 top-line metrics + period-over-period deltas.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  computeTopline,
  filterRows,
} from "@/lib/analytics/aggregate";
import { computeDelta } from "@/lib/analytics/delta";
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
  const periodMs = end.getTime() - start.getTime();
  const priorStart = new Date(start.getTime() - periodMs);
  const priorEnd = start;

  try {
    const rows = await loadPostAggRows(brandId, priorStart, end);
    const followerSeries = await loadFollowerSeries(brandId, priorStart, end);

    const currentRows = filterRows(rows, filters, { start, end });
    const priorRows = filterRows(rows, filters, {
      start: priorStart,
      end: priorEnd,
    });
    const currentFollowerDelta = followerDeltaInWindow(followerSeries, start, end);
    const priorFollowerDelta = followerDeltaInWindow(
      followerSeries,
      priorStart,
      priorEnd,
    );

    const current = computeTopline(currentRows, currentFollowerDelta);
    const prior = computeTopline(priorRows, priorFollowerDelta);

    return NextResponse.json({
      data: {
        current,
        prior,
        deltas: {
          totalReach: computeDelta(current.totalReach, prior.totalReach),
          engagementRate: computeDelta(
            current.engagementRate,
            prior.engagementRate,
          ),
          followerDelta: computeDelta(current.followerDelta, prior.followerDelta),
          postsPublished: computeDelta(
            current.postsPublished,
            prior.postsPublished,
          ),
          avgReachPerPost: computeDelta(
            current.avgReachPerPost,
            prior.avgReachPerPost,
          ),
          topFormatEr: computeDelta(
            current.topFormat.avgEr,
            prior.topFormat.avgEr,
          ),
        },
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

function followerDeltaInWindow(
  series: Array<{ pulledAt: Date; followerCount: number | null }>,
  start: Date,
  end: Date,
): number {
  const inWin = series.filter(
    (s) =>
      s.pulledAt.getTime() >= start.getTime() &&
      s.pulledAt.getTime() <= end.getTime() &&
      s.followerCount != null,
  );
  if (inWin.length < 2) return 0;
  const first = inWin[0]!.followerCount ?? 0;
  const last = inWin[inWin.length - 1]!.followerCount ?? 0;
  return last - first;
}
