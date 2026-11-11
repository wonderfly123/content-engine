/**
 * GET /api/analytics/topline?brandId=...&channel=instagram|facebook&range=7d|30d|90d|all
 *
 * Summary cards for ONE channel (Instagram unless Facebook is selected):
 * followers (total + change in the window), views, reach, average watch time,
 * shares + saves, posts published.
 *
 * Instagram views and reach are account-wide for 7/30/90-day windows (everything people saw in
 * the window, old posts included). For "all time", and whenever the account call fails, they are
 * summed from the posts published in the window instead; `viewsSource` says which.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { filterRows, summarizePosts } from "@/lib/analytics/aggregate";
import { activeChannel, parseFilters, resolveRange } from "@/lib/analytics/filters";
import {
  loadEnabledChannels,
  loadFollowerSeries,
  loadPostAggRows,
} from "@/lib/analytics/queries";
import { fetchInstagramAccountTotals, fetchInstagramFollowerFlow } from "@/lib/publishing/meta-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ brandId: z.string().uuid() });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({ brandId: sp.get("brandId") });
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { code: "invalid_query" } }, { status: 400 });
  }
  const { brandId } = parsed.data;
  const filters = parseFilters(sp);
  const channel = activeChannel(filters);
  const { start, end } = resolveRange(filters);

  try {
    const enabledChannels = await loadEnabledChannels(brandId);
    const [rows, followerSeries] = await Promise.all([
      loadPostAggRows(brandId, start, end, enabledChannels),
      loadFollowerSeries(brandId, new Date("2010-01-01T00:00:00Z"), end, channel),
    ]);
    const summary = summarizePosts(filterRows(rows, { ...filters, channels: [channel] }, { start, end }));

    // Followers: latest known total, and how it moved inside the window.
    const known = followerSeries.filter((s) => s.followerCount != null);
    const inWindow = known.filter((s) => s.pulledAt >= start && s.pulledAt <= end);
    const total = known.length ? (known[known.length - 1]!.followerCount ?? 0) : null;
    const change = inWindow.length >= 2 ? (inWindow[inWindow.length - 1]!.followerCount ?? 0) - (inWindow[0]!.followerCount ?? 0) : null;

    let views = summary.views;
    let reach = summary.reach;
    let viewsSource: "account" | "posts" = "posts";
    let reachIsSummed = summary.postsPublished > 1;
    let followerFlow: { gained: number; lost: number } | null = null;
    if (channel === "instagram" && filters.dateRange !== "all" && filters.dateRange !== "custom") {
      try {
        const [conn] = await db
          .select()
          .from(schema.channelConnections)
          .where(and(eq(schema.channelConnections.brandId, brandId), eq(schema.channelConnections.channel, "instagram")))
          .limit(1);
        const accountId = conn?.metaJson.igBusinessId ?? conn?.externalAccountId;
        if (conn && conn.status === "connected" && accountId) {
          const [totals, flow] = await Promise.all([
            fetchInstagramAccountTotals({ accountId, accessToken: conn.accessToken, since: start, until: end }),
            // Instagram's own count of follows and unfollows; a failure here must not lose the views.
            fetchInstagramFollowerFlow({ accountId, accessToken: conn.accessToken, since: start, until: end }).catch(() => null),
          ]);
          views = totals.views;
          reach = totals.reach;
          reachIsSummed = totals.reachIsSummed;
          viewsSource = "account";
          followerFlow = flow;
        }
      } catch {
        // Fall back to the per-post sums already computed.
      }
    }

    return NextResponse.json({
      data: {
        channel,
        enabledChannels,
        current: {
          followers: {
            total,
            // Prefer Instagram's follows/unfollows for the window; fall back to our own daily snapshots.
            gained: followerFlow?.gained ?? null,
            lost: followerFlow?.lost ?? null,
            net: followerFlow ? followerFlow.gained - followerFlow.lost : change,
          },
          views,
          reach,
          reachIsSummed,
          viewsSource,
          avgWatchSec: summary.avgWatchSec,
          stayedPast3sPct: summary.stayedPast3sPct,
          sharesPer1kViews: summary.sharesPer1kViews,
          savesPer1kViews: summary.savesPer1kViews,
          sharesAndSaves: summary.sharesAndSaves,
          postsPublished: summary.postsPublished,
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
