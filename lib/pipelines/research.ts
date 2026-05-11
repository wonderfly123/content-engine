/**
 * Pipeline 1 — Research (weekly per brand). Section 6 of the spec.
 *
 * Pulls competitor posts via the CompetitorScraper adapter, scrapes competitor
 * websites + keyword SERPs via the Researcher adapter, aggregates trending
 * hashtags, derives a deterministic `llm_pattern_summary`, and inserts one
 * `research_bundles` row per brand.
 *
 * Adapters are injected so cron handlers can use the production singletons
 * and tests can pass mocks. No SDK is imported directly from this module.
 *
 * NOTE on `llm_pattern_summary`: the `LLMProvider` interface (Task 3) does
 * not expose a generic completion endpoint, only `generateBrief`,
 * `generateDraft`, `extractPersona`, and `generateImagePrompts`. Per the
 * task constraints we cannot modify `lib/llm`. As a v1 placeholder we
 * compute a deterministic summary from the aggregated findings so briefs
 * still receive a useful `research.llm_pattern_summary` context blob. A
 * follow-up should extend `LLMProvider` with `summarizePatterns(input)` and
 * wire it here. This is flagged in DONE_WITH_CONCERNS.
 */

import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import {
  getCompetitorScraper,
  getResearcher,
  type CompetitorPost,
  type CompetitorScraper,
  type Researcher,
} from "@/lib/research";
import type {
  CompetitorFinding,
  KeywordFinding,
  TrendingHashtag,
} from "@/lib/db/types";
import { recordEvent } from "./events";

export type DbOrTx = typeof defaultDb;

export interface RunResearchDeps {
  db?: DbOrTx;
  competitorScraper?: CompetitorScraper;
  researcher?: Researcher;
  now?: () => Date;
}

export interface ResearchResult {
  bundleId: string;
  status: "fresh" | "partial";
  competitorsPulled: number;
  competitorsFailed: number;
  keywordsPulled: number;
  keywordsFailed: number;
  sitesScraped: number;
  sitesFailed: number;
}

export async function runResearchForBrand(
  brandId: string,
  deps: RunResearchDeps = {},
): Promise<ResearchResult> {
  const db = deps.db ?? defaultDb;
  const scraper = deps.competitorScraper ?? getCompetitorScraper();
  const researcher = deps.researcher ?? getResearcher();
  const now = deps.now ?? (() => new Date());

  const errorNotes: string[] = [];

  // ---- 1. Competitor IG posts ---------------------------------------------
  const competitorRows = await db
    .select()
    .from(schema.competitors)
    .where(eq(schema.competitors.brandId, brandId));

  const competitorFindings: CompetitorFinding[] = [];
  const allCompetitorPosts: CompetitorPost[] = [];
  let competitorsPulled = 0;
  let competitorsFailed = 0;
  for (const comp of competitorRows) {
    try {
      const posts = await scraper.fetchRecentPosts(
        comp.handle,
        comp.pullWindowDays,
      );
      allCompetitorPosts.push(...posts);
      competitorFindings.push({
        competitorId: comp.id,
        handle: comp.handle,
        topPosts: posts
          .slice()
          .sort(
            (a, b) =>
              ((b.likes ?? 0) + (b.comments ?? 0) * 3) -
              ((a.likes ?? 0) + (a.comments ?? 0) * 3),
          )
          .slice(0, 5)
          .map((p) => ({
            externalUrl: p.url,
            engagement: (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0),
            caption: p.caption,
            publishedAt: p.posted_at,
          })),
      });
      await db
        .update(schema.competitors)
        .set({ lastScrapedAt: now() })
        .where(eq(schema.competitors.id, comp.id));
      competitorsPulled++;
    } catch (err) {
      competitorsFailed++;
      errorNotes.push(
        `competitor ${comp.handle}: ${(err as Error).message}`,
      );
    }
  }

  // ---- 2. Competitor websites (diff vs prior bundle) ----------------------
  const priorBundle = await db
    .select()
    .from(schema.researchBundles)
    .where(eq(schema.researchBundles.brandId, brandId))
    .orderBy(desc(schema.researchBundles.pulledAt))
    .limit(1);
  const priorFindings = priorBundle[0]?.competitorFindingsJson ?? [];

  let sitesScraped = 0;
  let sitesFailed = 0;
  for (const comp of competitorRows) {
    if (!comp.url) continue;
    try {
      const site = await researcher.scrapeSite(comp.url);
      const priorForThis = priorFindings.find(
        (f) => f.competitorId === comp.id,
      );
      const isNew =
        !priorForThis ||
        JSON.stringify(priorForThis).slice(0, 200) !==
          (site.title ?? "") + (site.description ?? "").slice(0, 100);
      const existing = competitorFindings.find(
        (f) => f.competitorId === comp.id,
      );
      const siteSummary = {
        externalUrl: site.url,
        caption: site.title ?? site.description,
        publishedAt: site.scraped_at,
        engagement: isNew ? 1 : 0,
      };
      if (existing) existing.topPosts.unshift(siteSummary);
      else
        competitorFindings.push({
          competitorId: comp.id,
          handle: comp.handle,
          topPosts: [siteSummary],
        });
      sitesScraped++;
    } catch (err) {
      sitesFailed++;
      errorNotes.push(`site ${comp.url}: ${(err as Error).message}`);
    }
  }

  // ---- 3. Keyword SERP pulls ----------------------------------------------
  const keywordRows = await db
    .select()
    .from(schema.keywords)
    .where(
      and(
        eq(schema.keywords.brandId, brandId),
        eq(schema.keywords.status, "active"),
      ),
    );

  const keywordFindings: KeywordFinding[] = [];
  let keywordsPulled = 0;
  let keywordsFailed = 0;
  for (const kw of keywordRows) {
    try {
      const results = await researcher.searchKeyword(kw.term);
      keywordFindings.push({
        keywordId: kw.id,
        term: kw.term,
        results: results.slice(0, 5).map((r, i) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
          rank: r.position ?? i + 1,
        })),
      });
      await db
        .update(schema.keywords)
        .set({ lastPulledAt: now() })
        .where(eq(schema.keywords.id, kw.id));
      keywordsPulled++;
    } catch (err) {
      keywordsFailed++;
      errorNotes.push(`keyword ${kw.term}: ${(err as Error).message}`);
    }
  }

  // ---- 4. Aggregate trending hashtags -------------------------------------
  const hashtagStats = new Map<string, { freq: number; eng: number }>();
  for (const post of allCompetitorPosts) {
    const tags = post.hashtags ?? [];
    const engagement =
      (post.likes ?? 0) + (post.comments ?? 0) * 3 + (post.shares ?? 0) * 5;
    for (const raw of tags) {
      const tag = raw.toLowerCase().replace(/^#/, "");
      if (!tag) continue;
      const entry = hashtagStats.get(tag) ?? { freq: 0, eng: 0 };
      entry.freq++;
      entry.eng += engagement;
      hashtagStats.set(tag, entry);
    }
  }
  const trendingHashtags: TrendingHashtag[] = Array.from(hashtagStats.entries())
    .map(([tag, s]) => ({
      tag,
      frequency: s.freq,
      weightedEngagement: s.eng,
    }))
    .sort((a, b) => b.weightedEngagement - a.weightedEngagement)
    .slice(0, 25);

  // ---- 5. Pattern summary (deterministic v1 — see file header) -----------
  const summaryParts: string[] = [];
  if (competitorFindings.length > 0) {
    summaryParts.push(
      `Pulled ${competitorsPulled} competitor accounts; top engagement leaders: ${competitorFindings
        .slice(0, 3)
        .map((c) => c.handle)
        .join(", ")}.`,
    );
  }
  if (trendingHashtags.length > 0) {
    summaryParts.push(
      `Top hashtags by weighted engagement: ${trendingHashtags
        .slice(0, 8)
        .map((h) => `#${h.tag}`)
        .join(", ")}.`,
    );
  }
  if (keywordFindings.length > 0) {
    summaryParts.push(
      `Keyword SERP coverage: ${keywordFindings.map((k) => k.term).join(", ")}.`,
    );
  }
  if (summaryParts.length === 0) {
    summaryParts.push(
      "No competitor / keyword data available yet — bundle is empty.",
    );
  }
  const llmPatternSummary = summaryParts.join(" ");

  // ---- 6. Insert research_bundles row -------------------------------------
  const partial =
    competitorsFailed > 0 || keywordsFailed > 0 || sitesFailed > 0;
  const status = partial ? "partial" : "fresh";

  const inserted = await db
    .insert(schema.researchBundles)
    .values({
      brandId,
      competitorFindingsJson: competitorFindings,
      keywordFindingsJson: keywordFindings,
      trendingHashtagsJson: trendingHashtags,
      llmPatternSummary,
      status,
      errorNotes: errorNotes.length > 0 ? errorNotes.join("\n") : null,
    })
    .returning({ id: schema.researchBundles.id });

  const bundleId = inserted[0]!.id;
  await recordEvent(
    {
      entityType: "research_bundle",
      entityId: bundleId,
      toStatus: status,
      note: `competitors=${competitorsPulled}/${competitorRows.length} keywords=${keywordsPulled}/${keywordRows.length} sites=${sitesScraped}`,
    },
    db,
  );

  return {
    bundleId,
    status,
    competitorsPulled,
    competitorsFailed,
    keywordsPulled,
    keywordsFailed,
    sitesScraped,
    sitesFailed,
  };
}

/** Run research for all active brands; used by the weekly cron handler. */
export async function runResearchForAllBrands(
  deps: RunResearchDeps = {},
): Promise<{ brandsProcessed: number; bundleIds: string[]; errors: string[] }> {
  const db = deps.db ?? defaultDb;
  const brands = await db
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(eq(schema.brands.status, "active"));
  const bundleIds: string[] = [];
  const errors: string[] = [];
  for (const b of brands) {
    try {
      const r = await runResearchForBrand(b.id, deps);
      bundleIds.push(r.bundleId);
    } catch (err) {
      errors.push(`brand ${b.id}: ${(err as Error).message}`);
    }
  }
  return { brandsProcessed: brands.length, bundleIds, errors };
}
