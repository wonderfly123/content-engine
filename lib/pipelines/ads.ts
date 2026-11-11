/**
 * Pipeline: Meta Marketing API ingest (paid).
 *
 * Two phases — both run inside a single cron handler:
 *   1. Metadata refresh — pull campaigns, ad sets, ads, creatives. Upsert
 *      into the metadata tables. Cheap; runs every cron tick.
 *   2. Daily insights pull — `/act_{id}/insights?level=ad&time_increment=1`
 *      over a trailing window (default 30 days). Upsert by (ad_id, day).
 *
 * Per-brand iteration:
 *   - Read every `channel_connections` row with channel='facebook' (Page
 *     tokens are valid for ads_read on the user's Business-Manager ad
 *     accounts) AND meta_json.adAccountId present AND status='connected'.
 *   - One ad account per brand for v1 (multi-account picker is OAuth-time).
 *
 * Idempotency:
 *   - Metadata tables use TEXT PKs equal to Meta's ids → ON CONFLICT DO UPDATE.
 *   - ad_insights has UNIQUE(ad_id, day) → ON CONFLICT DO UPDATE so the
 *     trailing window can be re-pulled safely.
 */

import { eq, sql } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import type { ChannelConnectionMeta } from "@/lib/db/types";
import {
  MetaGraphError,
  fetchAdInsightsDaily,
  getAdCreative,
  listAds,
  listAdSets,
  listCampaigns,
} from "@/lib/publishing/meta-graph";

export type DbOrTx = typeof defaultDb;

export interface AdsIngestDeps {
  db?: DbOrTx;
  now?: () => Date;
  /** Trailing window for daily insights pulls. Default 30 days. */
  windowDays?: number;
  /**
   * If true, also fetch each ad's creative.effective_object_story_id (used
   * to join boosted posts to organic). Costs one Graph call per ad — runs
   * only on full metadata refresh.
   */
  refreshCreatives?: boolean;
}

export interface AdsIngestResult {
  brandsProcessed: number;
  campaignsUpserted: number;
  adSetsUpserted: number;
  adsUpserted: number;
  insightsRowsUpserted: number;
  errors: Array<{ brandId: string; message: string }>;
}

const DEFAULT_WINDOW_DAYS = 30;

export async function ingestAds(
  deps: AdsIngestDeps = {},
): Promise<AdsIngestResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? (() => new Date());
  const windowDays = deps.windowDays ?? DEFAULT_WINDOW_DAYS;
  const refreshCreatives = deps.refreshCreatives ?? true;

  const result: AdsIngestResult = {
    brandsProcessed: 0,
    campaignsUpserted: 0,
    adSetsUpserted: 0,
    adsUpserted: 0,
    insightsRowsUpserted: 0,
    errors: [],
  };

  // Find connections that have an ad account wired up.
  const conns = await db
    .select()
    .from(schema.channelConnections)
    .where(eq(schema.channelConnections.status, "connected"));

  // De-dupe by (brandId, adAccountId) — IG + FB rows share the same ad acct.
  // Skip ad accounts that aren't fully active (Meta `account_status != 1`)
  // so we don't burn BUC quota polling dead accounts.
  const seen = new Set<string>();
  const workItems: Array<{
    brandId: string;
    adAccountId: string;
    accessToken: string;
  }> = [];
  for (const c of conns) {
    const meta = c.metaJson as ChannelConnectionMeta;
    const adAccountId = meta.adAccountId;
    if (!adAccountId) continue;
    // Look up account_status from the stored adAccounts metadata.
    const accountEntry = meta.adAccounts?.find((a) => a.id === adAccountId);
    if (accountEntry && accountEntry.accountStatus !== 1) {
      // Status: 2=DISABLED, 3=UNSETTLED, 7=PENDING_RISK_REVIEW,
      // 8=PENDING_SETTLEMENT, 9=IN_GRACE_PERIOD, 100=PENDING_CLOSURE,
      // 101=CLOSED. Skip all of them — `1=ACTIVE` is the only deliverable
      // state.
      continue;
    }
    const key = `${c.brandId}:${adAccountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    workItems.push({
      brandId: c.brandId,
      adAccountId,
      accessToken: c.accessToken,
    });
  }

  /**
   * Convert a minor-unit budget (cents) string to a major-unit (dollars)
   * decimal string for storage. The Meta API returns budgets as e.g. "1234"
   * meaning $12.34 — we normalize so the column is comparable to
   * `ad_insights.spend` which is already in major units.
   */
  const toMajor = (minor: string | undefined | null): string | null => {
    if (!minor) return null;
    const n = Number(minor);
    if (!Number.isFinite(n)) return null;
    return (n / 100).toFixed(2);
  };

  const today = now();
  const ymd = (d: Date): string => d.toISOString().slice(0, 10);
  const since = ymd(
    new Date(today.getTime() - windowDays * 24 * 60 * 60 * 1000),
  );
  const until = ymd(today);

  for (const item of workItems) {
    try {
      // ---- 1. Metadata refresh ----
      const campaigns = await listCampaigns({
        adAccountId: item.adAccountId,
        accessToken: item.accessToken,
      });
      for (const c of campaigns) {
        const campaignValues = {
          brandId: item.brandId,
          adAccountId: item.adAccountId,
          name: c.name ?? "",
          objective: c.objective ?? null,
          status: c.status ?? null,
          effectiveStatus: c.effective_status ?? null,
          buyingType: c.buying_type ?? null,
          dailyBudget: toMajor(c.daily_budget),
          lifetimeBudget: toMajor(c.lifetime_budget),
          startTime: c.start_time ? new Date(c.start_time) : null,
          stopTime: c.stop_time ? new Date(c.stop_time) : null,
          rawJson: c as unknown as Record<string, unknown>,
        };
        await db
          .insert(schema.adCampaigns)
          .values({ id: c.id, ...campaignValues })
          .onConflictDoUpdate({
            target: schema.adCampaigns.id,
            set: { ...campaignValues, refreshedAt: new Date() },
          });
        result.campaignsUpserted++;
      }

      const adSets = await listAdSets({
        adAccountId: item.adAccountId,
        accessToken: item.accessToken,
      });
      for (const s of adSets) {
        const adSetValues = {
          brandId: item.brandId,
          adAccountId: item.adAccountId,
          campaignId: s.campaign_id,
          name: s.name ?? "",
          status: s.status ?? null,
          effectiveStatus: s.effective_status ?? null,
          optimizationGoal: s.optimization_goal ?? null,
          billingEvent: s.billing_event ?? null,
          dailyBudget: toMajor(s.daily_budget),
          lifetimeBudget: toMajor(s.lifetime_budget),
          startTime: s.start_time ? new Date(s.start_time) : null,
          endTime: s.end_time ? new Date(s.end_time) : null,
          rawJson: s as unknown as Record<string, unknown>,
        };
        await db
          .insert(schema.adSets)
          .values({ id: s.id, ...adSetValues })
          .onConflictDoUpdate({
            target: schema.adSets.id,
            set: { ...adSetValues, refreshedAt: new Date() },
          });
        result.adSetsUpserted++;
      }

      const adsList = await listAds({
        adAccountId: item.adAccountId,
        accessToken: item.accessToken,
      });
      for (const a of adsList) {
        let effectiveObjectStoryId: string | null = null;
        let instagramPermalinkUrl: string | null = null;
        let creativeThumbnailUrl: string | null = null;
        let creativeBody: string | null = null;
        if (refreshCreatives && a.creative?.id) {
          const cr = await getAdCreative({
            creativeId: a.creative.id,
            accessToken: item.accessToken,
          });
          effectiveObjectStoryId = cr?.effective_object_story_id ?? null;
          instagramPermalinkUrl = cr?.instagram_permalink_url ?? null;
          creativeThumbnailUrl = cr?.thumbnail_url ?? null;
          creativeBody = cr?.body ?? null;
        }
        const adValues = {
          brandId: item.brandId,
          adAccountId: item.adAccountId,
          adsetId: a.adset_id,
          campaignId: a.campaign_id,
          name: a.name ?? "",
          status: a.status ?? null,
          effectiveStatus: a.effective_status ?? null,
          creativeId: a.creative?.id ?? null,
          effectiveObjectStoryId,
          instagramPermalinkUrl,
          creativeThumbnailUrl,
          creativeBody,
          rawJson: a as unknown as Record<string, unknown>,
        };
        await db
          .insert(schema.ads)
          .values({ id: a.id, ...adValues })
          .onConflictDoUpdate({
            target: schema.ads.id,
            set: { ...adValues, refreshedAt: new Date() },
          });
        result.adsUpserted++;
      }

      // ---- 2. Daily insights pull ----
      const rows = await fetchAdInsightsDaily({
        adAccountId: item.adAccountId,
        accessToken: item.accessToken,
        since,
        until,
      });
      for (const r of rows) {
        await db
          .insert(schema.adInsights)
          .values({
            brandId: item.brandId,
            adAccountId: item.adAccountId,
            adId: r.ad_id,
            adsetId: r.adset_id,
            campaignId: r.campaign_id,
            day: r.date_start,
            spend: r.spend ?? null,
            impressions: r.impressions ? Number(r.impressions) : null,
            reach: r.reach ? Number(r.reach) : null,
            frequency: r.frequency ?? null,
            clicks: r.clicks ? Number(r.clicks) : null,
            uniqueClicks: r.unique_clicks ? Number(r.unique_clicks) : null,
            inlineLinkClicks: r.inline_link_clicks
              ? Number(r.inline_link_clicks)
              : null,
            outboundClicks: outboundClicksTotal(r.outbound_clicks),
            ctr: r.ctr ?? null,
            cpc: r.cpc ?? null,
            cpm: r.cpm ?? null,
            cpp: r.cpp ?? null,
            rawJson: r as unknown as Record<string, unknown>,
          })
          .onConflictDoUpdate({
            target: [schema.adInsights.adId, schema.adInsights.day],
            set: {
              spend: r.spend ?? null,
              impressions: r.impressions ? Number(r.impressions) : null,
              reach: r.reach ? Number(r.reach) : null,
              frequency: r.frequency ?? null,
              clicks: r.clicks ? Number(r.clicks) : null,
              uniqueClicks: r.unique_clicks ? Number(r.unique_clicks) : null,
              inlineLinkClicks: r.inline_link_clicks
                ? Number(r.inline_link_clicks)
                : null,
              outboundClicks: outboundClicksTotal(r.outbound_clicks),
              ctr: r.ctr ?? null,
              cpc: r.cpc ?? null,
              cpm: r.cpm ?? null,
              cpp: r.cpp ?? null,
              pulledAt: sql`now()`,
              rawJson: r as unknown as Record<string, unknown>,
            },
          });
        result.insightsRowsUpserted++;
      }

      result.brandsProcessed++;
    } catch (err) {
      const msg =
        err instanceof MetaGraphError
          ? `${err.code}: ${err.message}`
          : (err as Error).message;
      result.errors.push({ brandId: item.brandId, message: msg });
      // eslint-disable-next-line no-console
      console.error(`[ads] brand=${item.brandId} failed: ${msg}`);
    }
  }

  return result;
}

function outboundClicksTotal(
  arr: Array<{ action_type: string; value: string }> | undefined,
): number | null {
  if (!arr || arr.length === 0) return null;
  let total = 0;
  for (const x of arr) {
    const n = Number(x.value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}
