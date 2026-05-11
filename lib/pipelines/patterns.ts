/**
 * Pipeline 6 — Pattern recompute (nightly). Section 6 of the spec.
 *
 * Reads the last 30 days of `analytics_snapshots` for each brand and computes
 * deterministic SQL aggregations (no LLM needed for v1):
 *   - Top hooks by avg engagement rate (joined via posts → drafts → briefs)
 *   - Format performance: avg reach + ER per format
 *   - ICP performance: aggregate by brief.icp_id
 *   - Posting time × day-of-week heatmap
 *
 * Result is cached as JSON in `brands.settings_json.patterns`.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import type { BrandSettings } from "@/lib/db/types";

export type DbOrTx = typeof defaultDb;

export interface PatternResult {
  computed_at: string;
  what_works: Array<{ kind: string; label: string; metric: number }>;
  what_to_avoid: Array<{ kind: string; label: string; metric: number }>;
  time_heatmap: Array<{
    dayOfWeek: number;
    hourUtc: number;
    avgReach: number;
    samples: number;
  }>;
  format_performance: Array<{
    format: string;
    avgReach: number;
    avgEngagement: number;
    samples: number;
  }>;
  icp_performance: Array<{
    icpId: string;
    avgReach: number;
    samples: number;
  }>;
}

export interface RecomputeDeps {
  db?: DbOrTx;
  now?: () => Date;
}

export async function recomputePatternsForBrand(
  brandId: string,
  deps: RecomputeDeps = {},
): Promise<PatternResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? (() => new Date());
  const since = new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000);

  // Latest snapshot per post in the window — use a window function to take
  // the most recent row per post.
  const latestSnapshots = await db.execute(sql`
    WITH ranked AS (
      SELECT s.*, p.channel, p.published_at, p.draft_id,
             ROW_NUMBER() OVER (PARTITION BY s.post_id ORDER BY s.pulled_at DESC) AS rn
        FROM analytics_snapshots s
        JOIN posts p ON p.id = s.post_id
       WHERE s.brand_id = ${brandId}
         AND p.published_at >= ${since}
    )
    SELECT post_id, reach, impressions, likes, comments, shares, saves,
           video_views, channel, published_at, draft_id
      FROM ranked
     WHERE rn = 1
  `);
  const rows = ((latestSnapshots as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []).map(normalizeSnapshotRow);

  // Pull the join: draft → brief → format, hook, icp_id.
  const briefByDraft = new Map<
    string,
    { briefId: string; format: string; hook: string; icpId: string | null }
  >();
  if (rows.length > 0) {
    const draftIds = Array.from(new Set(rows.map((r) => r.draftId)));
    const joinRows = await db.execute(sql`
      SELECT d.id AS draft_id, d.format AS format, b.id AS brief_id,
             b.hook AS hook, b.icp_id AS icp_id
        FROM drafts d
        JOIN briefs b ON b.id = d.brief_id
       WHERE d.id IN ${sql.raw(`(${draftIds.map((id) => `'${id}'`).join(",")})`)}
    `);
    const joinList = ((joinRows as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []);
    for (const j of joinList) {
      briefByDraft.set(String(j.draft_id), {
        briefId: String(j.brief_id),
        format: String(j.format),
        hook: String(j.hook ?? ""),
        icpId: j.icp_id ? String(j.icp_id) : null,
      });
    }
  }

  // ---- Format performance --------------------------------------------------
  const byFormat = new Map<
    string,
    { reach: number; eng: number; samples: number }
  >();
  // ---- Hook performance ----------------------------------------------------
  const byHook = new Map<
    string,
    { eng: number; reach: number; samples: number }
  >();
  // ---- ICP performance -----------------------------------------------------
  const byIcp = new Map<string, { reach: number; samples: number }>();
  // ---- Time heatmap --------------------------------------------------------
  const byTime = new Map<
    string,
    { reach: number; samples: number; dayOfWeek: number; hourUtc: number }
  >();

  for (const row of rows) {
    const meta = briefByDraft.get(row.draftId);
    const reach = row.reach ?? 0;
    const eng =
      (row.likes ?? 0) +
      (row.comments ?? 0) +
      (row.shares ?? 0) +
      (row.saves ?? 0);

    if (meta) {
      const f = byFormat.get(meta.format) ?? {
        reach: 0,
        eng: 0,
        samples: 0,
      };
      f.reach += reach;
      f.eng += eng;
      f.samples++;
      byFormat.set(meta.format, f);

      if (meta.hook) {
        const h = byHook.get(meta.hook) ?? {
          reach: 0,
          eng: 0,
          samples: 0,
        };
        h.reach += reach;
        h.eng += eng;
        h.samples++;
        byHook.set(meta.hook, h);
      }

      if (meta.icpId) {
        const i = byIcp.get(meta.icpId) ?? { reach: 0, samples: 0 };
        i.reach += reach;
        i.samples++;
        byIcp.set(meta.icpId, i);
      }
    }

    if (row.publishedAt) {
      const d = row.publishedAt;
      const key = `${d.getUTCDay()}-${d.getUTCHours()}`;
      const slot = byTime.get(key) ?? {
        reach: 0,
        samples: 0,
        dayOfWeek: d.getUTCDay(),
        hourUtc: d.getUTCHours(),
      };
      slot.reach += reach;
      slot.samples++;
      byTime.set(key, slot);
    }
  }

  const format_performance = Array.from(byFormat.entries())
    .map(([format, v]) => ({
      format,
      avgReach: v.samples ? v.reach / v.samples : 0,
      avgEngagement: v.samples ? v.eng / v.samples : 0,
      samples: v.samples,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  const icp_performance = Array.from(byIcp.entries())
    .map(([icpId, v]) => ({
      icpId,
      avgReach: v.samples ? v.reach / v.samples : 0,
      samples: v.samples,
    }))
    .sort((a, b) => b.avgReach - a.avgReach);

  const time_heatmap = Array.from(byTime.values())
    .map((v) => ({
      dayOfWeek: v.dayOfWeek,
      hourUtc: v.hourUtc,
      avgReach: v.samples ? v.reach / v.samples : 0,
      samples: v.samples,
    }))
    .sort((a, b) => b.avgReach - a.avgReach);

  const hookScores = Array.from(byHook.entries())
    .map(([hook, v]) => ({
      hook,
      avgEngagement: v.samples ? v.eng / v.samples : 0,
      samples: v.samples,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  const what_works = [
    ...hookScores.slice(0, 3).map((h) => ({
      kind: "hook",
      label: h.hook,
      metric: h.avgEngagement,
    })),
    ...format_performance.slice(0, 2).map((f) => ({
      kind: "format",
      label: f.format,
      metric: f.avgEngagement,
    })),
  ];
  const what_to_avoid = [
    ...hookScores
      .slice(-3)
      .reverse()
      .filter((h) => h.samples >= 2)
      .map((h) => ({ kind: "hook", label: h.hook, metric: h.avgEngagement })),
    ...format_performance.slice(-1).map((f) => ({
      kind: "format",
      label: f.format,
      metric: f.avgEngagement,
    })),
  ];

  const result: PatternResult = {
    computed_at: now().toISOString(),
    what_works,
    what_to_avoid,
    time_heatmap,
    format_performance,
    icp_performance,
  };

  // Persist on brands.settings_json.patterns (preserve other keys).
  const brandRows = await db
    .select({ settings: schema.brands.settingsJson })
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  const settings: BrandSettings = brandRows[0]?.settings ?? {};
  const next: BrandSettings = { ...settings, patterns: result };
  await db
    .update(schema.brands)
    .set({ settingsJson: next, updatedAt: new Date() })
    .where(eq(schema.brands.id, brandId));

  return result;
}

export async function recomputePatternsForAllBrands(
  deps: RecomputeDeps = {},
): Promise<{ brandsProcessed: number; errors: string[] }> {
  const db = deps.db ?? defaultDb;
  const brands = await db
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(eq(schema.brands.status, "active"));
  const errors: string[] = [];
  for (const b of brands) {
    try {
      await recomputePatternsForBrand(b.id, deps);
    } catch (err) {
      errors.push(`brand ${b.id}: ${(err as Error).message}`);
    }
  }
  return { brandsProcessed: brands.length, errors };
}

interface SnapshotRow {
  draftId: string;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  publishedAt: Date | null;
}

function normalizeSnapshotRow(r: Record<string, unknown>): SnapshotRow {
  return {
    draftId: String(r.draft_id ?? ""),
    reach: numOrNull(r.reach),
    likes: numOrNull(r.likes),
    comments: numOrNull(r.comments),
    shares: numOrNull(r.shares),
    saves: numOrNull(r.saves),
    publishedAt: r.published_at ? new Date(String(r.published_at)) : null,
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const __internals = { and, gte };
