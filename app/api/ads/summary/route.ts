/**
 * GET /api/ads/summary
 *
 * Read-only topline + daily-trend aggregates over `ad_insights` for the Ads
 * page. Query params:
 *   - brandId (required, uuid) — ad tables carry brand_id directly.
 *   - days (optional, default 30, clamped 7-90) — trailing window.
 *
 * Blended CTR/CPC are computed from summed totals (clicks/impressions,
 * spend/clicks), never by averaging the per-row ctr/cpc columns.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

const querySchema = z.object({ brandId: z.string().uuid() });

/** Drizzle numeric / bigint aggregates come back as strings — parse safely. */
function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampDays(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  return Math.min(90, Math.max(7, Math.trunc(n)));
}

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
  const days = clampDays(sp.get("days"));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  try {
    const rows = await db
      .select({
        day: schema.adInsights.day,
        spend: sql<string | null>`sum(${schema.adInsights.spend})`,
        impressions: sql<string | null>`sum(${schema.adInsights.impressions})`,
        clicks: sql<string | null>`sum(${schema.adInsights.clicks})`,
      })
      .from(schema.adInsights)
      .where(
        and(
          eq(schema.adInsights.brandId, brandId),
          gte(schema.adInsights.day, since),
        ),
      )
      .groupBy(schema.adInsights.day)
      .orderBy(asc(schema.adInsights.day));

    const daily = rows.map((r) => ({
      day: r.day,
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
    }));

    const spend = daily.reduce((a, d) => a + d.spend, 0);
    const impressions = daily.reduce((a, d) => a + d.impressions, 0);
    const clicks = daily.reduce((a, d) => a + d.clicks, 0);

    return NextResponse.json({
      data: {
        topline: {
          spend,
          impressions,
          clicks,
          /** Fraction (0-1); multiply by 100 for display. */
          ctr: impressions > 0 ? clicks / impressions : 0,
          /** Dollars per click. */
          cpc: clicks > 0 ? spend / clicks : 0,
        },
        daily,
      },
      error: null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        data: null,
        error: { code: "query_failed", message: (err as Error).message },
      },
      { status: 500 },
    );
  }
}
