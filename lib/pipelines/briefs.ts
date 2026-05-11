/**
 * Pipeline 2 — Brief batch (weekly per brand). Section 6 of the spec.
 *
 * Reads the latest fresh/partial research bundle + brand persona/voice/ICPs +
 * cadence settings, generates one brief per cadence slot via the LLM adapter,
 * inserts `briefs` rows status='pending_review', and writes an audit event
 * per brief.
 *
 * Adapters are injected for testability.
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import { getLLMProvider, type LLMProvider, type BriefInput } from "@/lib/llm";
import type {
  Channel as DbChannel,
  ContentFormat as DbFormat,
} from "@/lib/db/enums";
import { recordEvent } from "./events";

export type DbOrTx = typeof defaultDb;

export interface RunBriefsDeps {
  db?: DbOrTx;
  llm?: LLMProvider;
  now?: () => Date;
}

export interface BriefBatchResult {
  brandId: string;
  briefsCreated: number;
  briefIds: string[];
  researchBundleId: string;
}

export async function runBriefBatchForBrand(
  brandId: string,
  deps: RunBriefsDeps = {},
): Promise<BriefBatchResult> {
  const db = deps.db ?? defaultDb;
  const llm = deps.llm ?? getLLMProvider();
  const now = deps.now ?? (() => new Date());

  // ---- 1. Read latest research bundle -------------------------------------
  const bundles = await db
    .select()
    .from(schema.researchBundles)
    .where(eq(schema.researchBundles.brandId, brandId))
    .orderBy(desc(schema.researchBundles.pulledAt))
    .limit(1);
  const bundle = bundles[0];
  if (!bundle) {
    throw new Error(
      `No research bundle for brand ${brandId} — run research first.`,
    );
  }
  if (bundle.status !== "fresh" && bundle.status !== "partial") {
    throw new Error(
      `Research bundle ${bundle.id} is stale; refresh before generating briefs.`,
    );
  }

  // ---- 2. Read brand + ICPs -----------------------------------------------
  const brandRows = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  const brand = brandRows[0];
  if (!brand) throw new Error(`Brand ${brandId} not found`);

  const icpRows = await db
    .select()
    .from(schema.icps)
    .where(eq(schema.icps.brandId, brandId));
  if (icpRows.length === 0) {
    throw new Error(`Brand ${brandId} has no ICPs configured`);
  }

  // ---- 3. Cadence → slot list ---------------------------------------------
  const cadenceRows = await db
    .select()
    .from(schema.cadenceSettings)
    .where(
      and(
        eq(schema.cadenceSettings.brandId, brandId),
        eq(schema.cadenceSettings.enabled, true),
      ),
    );
  const slots: Array<{ channel: DbChannel; format: DbFormat; date: string }> =
    [];
  // Spread slots evenly across the coming Mon→Sun.
  const totalCount = cadenceRows.reduce((n, r) => n + r.perWeek, 0);
  if (totalCount === 0) {
    return {
      brandId,
      briefsCreated: 0,
      briefIds: [],
      researchBundleId: bundle.id,
    };
  }
  const startDate = nextMonday(now());
  let cursor = 0;
  for (const row of cadenceRows) {
    for (let i = 0; i < row.perWeek; i++) {
      const dayOffset = Math.round((cursor / totalCount) * 6); // 0..6
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + dayOffset);
      slots.push({
        channel: row.channel,
        format: row.format,
        date: d.toISOString().slice(0, 10),
      });
      cursor++;
    }
  }

  // ---- 4. Recent rejections (last 30 days) --------------------------------
  const thirtyDaysAgo = new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000);
  const rejections = await db
    .select({
      reason: schema.briefs.rejectionReason,
      createdAt: schema.briefs.createdAt,
    })
    .from(schema.briefs)
    .where(
      and(
        eq(schema.briefs.brandId, brandId),
        eq(schema.briefs.status, "rejected"),
        gte(schema.briefs.createdAt, thirtyDaysAgo),
      ),
    );
  const rejectionContext = rejections
    .filter((r) => r.reason)
    .map((r) => ({
      briefOrDraft: "brief" as const,
      reason: r.reason as string,
      at: r.createdAt.toISOString(),
    }));

  // ---- 5. Generate brief per slot -----------------------------------------
  const briefIds: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const icp = icpRows[i % icpRows.length]!; // rotate ICPs

    const briefInput: BriefInput = {
      persona: mapPersona(brand.personaJson),
      voice: mapVoice(brand.voiceJson),
      icp: {
        name: icp.name,
        description: icp.description,
        pain_points: icp.painPoints,
        where_they_hang_out: icp.whereTheyHangOut,
        content_they_engage_with: icp.contentTheyEngageWith,
      },
      research: {
        llm_pattern_summary: bundle.llmPatternSummary,
        competitor_findings_json: bundle.competitorFindingsJson,
        keyword_findings_json: bundle.keywordFindingsJson,
        trending_hashtags_json: bundle.trendingHashtagsJson,
      },
      rejections: rejectionContext,
      channel: slot.channel,
      format: slot.format,
      target_date: slot.date,
    };

    let draft;
    try {
      draft = await llm.generateBrief(briefInput);
    } catch (err) {
      // One bad brief shouldn't fail the whole batch — log and skip.
      // eslint-disable-next-line no-console
      console.error(
        `[briefs] generateBrief failed for slot ${i} brand=${brandId}: ${(err as Error).message}`,
      );
      continue;
    }

    const inserted = await db
      .insert(schema.briefs)
      .values({
        brandId,
        channel: slot.channel,
        format: slot.format,
        icpId: icp.id,
        researchBundleId: bundle.id,
        title: deriveTitle(draft.hook),
        hook: draft.hook,
        angle: draft.angle,
        keyMessage: draft.key_message,
        suggestedHashtags: draft.suggested_hashtags,
        suggestedCta: draft.suggested_cta,
        inspirationPostRefs: draft.inspiration_post_refs.map((r) => ({
          externalUrl: r.external_url ?? "",
          why: r.why,
          competitorId: r.ref_id,
        })),
        targetPublishDate: slot.date,
        status: "pending_review",
      })
      .returning({ id: schema.briefs.id });
    const id = inserted[0]!.id;
    briefIds.push(id);
    await recordEvent(
      {
        entityType: "brief",
        entityId: id,
        toStatus: "pending_review",
        note: `slot=${slot.channel}/${slot.format} date=${slot.date}`,
      },
      db,
    );
  }

  return {
    brandId,
    briefsCreated: briefIds.length,
    briefIds,
    researchBundleId: bundle.id,
  };
}

export async function runBriefBatchForAllBrands(
  deps: RunBriefsDeps = {},
): Promise<{
  brandsProcessed: number;
  totalBriefs: number;
  errors: string[];
}> {
  const db = deps.db ?? defaultDb;
  const brands = await db
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(eq(schema.brands.status, "active"));
  let totalBriefs = 0;
  const errors: string[] = [];
  for (const b of brands) {
    try {
      const r = await runBriefBatchForBrand(b.id, deps);
      totalBriefs += r.briefsCreated;
    } catch (err) {
      errors.push(`brand ${b.id}: ${(err as Error).message}`);
    }
  }
  return { brandsProcessed: brands.length, totalBriefs, errors };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export interface CadenceRowLite {
  channel: DbChannel;
  format: DbFormat;
  perWeek: number;
}

/**
 * Pure helper: turn cadence rows into Mon→Sun-spread slot list. Exported for
 * unit testing of slot-count invariants.
 */
export function computeSlots(
  cadenceRows: CadenceRowLite[],
  weekStartMonday: Date,
): Array<{ channel: DbChannel; format: DbFormat; date: string }> {
  const totalCount = cadenceRows.reduce((n, r) => n + r.perWeek, 0);
  const slots: Array<{ channel: DbChannel; format: DbFormat; date: string }> = [];
  if (totalCount === 0) return slots;
  let cursor = 0;
  for (const row of cadenceRows) {
    for (let i = 0; i < row.perWeek; i++) {
      const dayOffset = Math.round((cursor / totalCount) * 6);
      const d = new Date(weekStartMonday);
      d.setUTCDate(d.getUTCDate() + dayOffset);
      slots.push({
        channel: row.channel,
        format: row.format,
        date: d.toISOString().slice(0, 10),
      });
      cursor++;
    }
  }
  return slots;
}

export function nextMonday(from: Date): Date {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const delta = ((1 - day + 7) % 7) || 7; // always forward, even if today is Mon
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

function deriveTitle(hook: string): string {
  const cleaned = hook.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57).trimEnd() + "…";
}

function mapPersona(persona: unknown): BriefInput["persona"] {
  const p = (persona ?? {}) as Record<string, unknown>;
  return {
    mission: String(p.mission ?? ""),
    audience_summary: String(p.audienceSummary ?? p.audience_summary ?? ""),
    archetype: String(p.archetype ?? ""),
    pov: String(p.pointOfView ?? p.pov ?? ""),
    traits: (p.traits as string[]) ?? [],
  };
}

function mapVoice(voice: unknown): BriefInput["voice"] {
  const v = (voice ?? {}) as Record<string, unknown>;
  return {
    tone_sliders: (v.toneSliders as Record<string, number>) ?? undefined,
    emoji_policy:
      (v.emojiPolicy as "none" | "sparing" | "liberal" | undefined) ??
      undefined,
    hashtag_style: (v.hashtagStyle as
      | "none"
      | "inline"
      | "trailing"
      | "block"
      | undefined) ?? undefined,
    reading_level: (v.readingLevel as string | undefined) ?? undefined,
    banned_words: (v.bannedWords as string[] | undefined) ?? undefined,
    signature_phrases:
      (v.signaturePhrases as string[] | undefined) ?? undefined,
  };
}

// Re-export to keep `inArray` available for future use (silence unused).
export const __internals = { inArray };
