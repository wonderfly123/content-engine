/**
 * GET /api/ads/campaigns
 *
 * Campaign metadata + trailing-30d performance aggregates for the Ads page.
 * Query params:
 *   - brandId (required, uuid)
 *
 * Two queries (campaign list + insights grouped by campaign_id) merged in JS;
 * blended CTR/CPC from totals. Sorted by 30d spend desc.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

const querySchema = z.object({ brandId: z.string().uuid() });

const AGG_WINDOW_DAYS = 30;

/** Drizzle numeric / bigint aggregates come back as strings — parse safely. */
function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** numeric columns (budgets) come back as strings; null stays null. */
function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  const since = new Date(Date.now() - AGG_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  try {
    const [campaigns, aggs] = await Promise.all([
      db
        .select({
          id: schema.adCampaigns.id,
          name: schema.adCampaigns.name,
          status: schema.adCampaigns.status,
          effectiveStatus: schema.adCampaigns.effectiveStatus,
          objective: schema.adCampaigns.objective,
          dailyBudget: schema.adCampaigns.dailyBudget,
          lifetimeBudget: schema.adCampaigns.lifetimeBudget,
        })
        .from(schema.adCampaigns)
        .where(eq(schema.adCampaigns.brandId, brandId)),
      db
        .select({
          campaignId: schema.adInsights.campaignId,
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
        .groupBy(schema.adInsights.campaignId),
    ]);

    const aggByCampaign = new Map(
      aggs.map((a) => [
        a.campaignId,
        {
          spend: num(a.spend),
          impressions: num(a.impressions),
          clicks: num(a.clicks),
        },
      ]),
    );

    const out = campaigns
      .map((c) => {
        const agg = aggByCampaign.get(c.id) ?? {
          spend: 0,
          impressions: 0,
          clicks: 0,
        };
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          effectiveStatus: c.effectiveStatus,
          objective: c.objective,
          /** Major currency units (dollars) — normalized at ingest. */
          dailyBudget: numOrNull(c.dailyBudget),
          lifetimeBudget: numOrNull(c.lifetimeBudget),
          spend: agg.spend,
          impressions: agg.impressions,
          clicks: agg.clicks,
          /** Fraction (0-1); multiply by 100 for display. */
          ctr: agg.impressions > 0 ? agg.clicks / agg.impressions : 0,
          /** Dollars per click. */
          cpc: agg.clicks > 0 ? agg.spend / agg.clicks : 0,
        };
      })
      .sort((a, b) => b.spend - a.spend);

    return NextResponse.json({ data: { campaigns: out }, error: null });
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
