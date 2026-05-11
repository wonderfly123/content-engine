/**
 * Pipeline 3 — Draft generation (event-driven). Section 6 of the spec.
 *
 * Invoked from a server action when a brief is approved. Reads the brief +
 * brand voice + linked ICP + recent rejection context, calls
 * `llm.generateDraft`, inserts a `drafts` row, and writes audit events.
 *
 * Channel-specific shape (IG Reel vs Carousel vs Image vs FB Post) is
 * selected here based on the brief's `format`. The LLM provider is free to
 * return whichever fields apply; we persist only the ones that matter.
 */

import { and, desc, eq, gte } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import {
  getLLMProvider,
  type Brand as LLMBrand,
  type Brief as LLMBrief,
  type LLMProvider,
} from "@/lib/llm";
import {
  assertBriefTransition,
  assertDraftTransition,
} from "./state";
import { recordEvent } from "./events";

export type DbOrTx = typeof defaultDb;

export interface GenerateDraftDeps {
  db?: DbOrTx;
  llm?: LLMProvider;
  now?: () => Date;
}

export interface GenerateDraftResult {
  draftId: string;
  briefId: string;
  channel: string;
  format: string;
}

/**
 * Generate a draft for an approved brief.
 *
 * Preconditions:
 *   - brief.status ∈ {approved, edited}
 *   - brief.brand_id exists
 *
 * Postconditions:
 *   - one new `drafts` row, status='pending_review'
 *   - one `events` row recording the draft creation
 */
export async function generateDraftForBrief(
  briefId: string,
  deps: GenerateDraftDeps = {},
): Promise<GenerateDraftResult> {
  const db = deps.db ?? defaultDb;
  const llm = deps.llm ?? getLLMProvider();

  // ---- 1. Load brief + brand + ICP ----------------------------------------
  const briefRows = await db
    .select()
    .from(schema.briefs)
    .where(eq(schema.briefs.id, briefId))
    .limit(1);
  const brief = briefRows[0];
  if (!brief) throw new Error(`Brief ${briefId} not found`);
  if (brief.status !== "approved" && brief.status !== "edited") {
    throw new Error(
      `Brief ${briefId} status is ${brief.status}; must be approved/edited`,
    );
  }

  const existing = await db
    .select({ id: schema.drafts.id })
    .from(schema.drafts)
    .where(eq(schema.drafts.briefId, briefId))
    .limit(1);
  if (existing[0]) {
    throw new Error(
      `Draft already exists for brief ${briefId} (id=${existing[0].id})`,
    );
  }

  const brandRows = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.id, brief.brandId))
    .limit(1);
  const brand = brandRows[0];
  if (!brand) throw new Error(`Brand ${brief.brandId} not found`);

  // ---- 2. Voice few-shot is already on the brand row ----------------------
  // `brands.voice_examples` is the 3-5 example posts the LLM uses as few-shot.

  // ---- 3. Recent draft rejections (context) -------------------------------
  // We don't pass these to `generateDraft` because the current `LLMProvider`
  // interface signature is `generateDraft(brief, brand)` and we cannot widen
  // it (lib/llm is out-of-scope for this task). Brand-scoped voice examples
  // already carry the strongest signal. Rejection context is intentionally
  // deferred to `summarizePatterns` (follow-up; see research.ts header note).

  const llmBrand: LLMBrand = {
    id: brand.id,
    name: brand.name,
    persona_json: {
      mission: String(brand.personaJson.mission ?? ""),
      audience_summary: String(brand.personaJson.audienceSummary ?? ""),
      archetype: String(brand.personaJson.archetype ?? ""),
      pov: String(brand.personaJson.pointOfView ?? ""),
      traits: brand.personaJson.traits ?? [],
    },
    voice_json: {
      tone_sliders: brand.voiceJson.toneSliders as
        | Record<string, number>
        | undefined,
      emoji_policy: brand.voiceJson.emojiPolicy as
        | "none"
        | "sparing"
        | "liberal"
        | undefined,
      hashtag_style: brand.voiceJson.hashtagStyle as
        | "none"
        | "inline"
        | "trailing"
        | "block"
        | undefined,
      reading_level: brand.voiceJson.readingLevel,
      banned_words: brand.voiceJson.bannedWords,
      signature_phrases: brand.voiceJson.signaturePhrases,
    },
    voice_freeform: brand.voiceFreeform,
    voice_examples: brand.voiceExamples.map((v) => ({
      channel: v.channel as LLMBrand["voice_examples"][number]["channel"],
      text: v.caption,
      notes: v.notes,
    })),
  };

  const llmBrief: LLMBrief = {
    id: brief.id,
    brand_id: brief.brandId,
    channel: brief.channel,
    format: brief.format,
    title: brief.title,
    hook: brief.hook,
    angle: brief.angle,
    key_message: brief.keyMessage,
    suggested_hashtags: brief.suggestedHashtags,
    suggested_cta: brief.suggestedCta,
    inspiration_post_refs: brief.inspirationPostRefs.map((r) => ({
      external_url: r.externalUrl,
      why: r.why ?? "",
      ref_id: r.competitorId ?? r.inspirationId,
    })),
    target_publish_date: brief.targetPublishDate ?? undefined,
  };

  // ---- 4. Call LLM --------------------------------------------------------
  const draft = await llm.generateDraft(llmBrief, llmBrand);

  // ---- 5. Persist per-format ---------------------------------------------
  const isReel = brief.format === "reel";
  const isCarousel = brief.format === "carousel";
  const scriptJson = isReel && draft.script_json
    ? mapReelScript(draft.script_json)
    : null;
  const slideJson =
    isCarousel && draft.slide_json
      ? draft.slide_json.slides.map((s) => ({
          index: s.index,
          copy: s.copy,
          imagePrompt: s.image_prompt,
          styleHint: s.style_hint,
        }))
      : null;

  const inserted = await db
    .insert(schema.drafts)
    .values({
      briefId,
      brandId: brief.brandId,
      channel: brief.channel,
      format: brief.format,
      caption: draft.caption,
      body: draft.body ?? null,
      scriptJson,
      slideJson,
      imagePrompts: draft.image_prompts ?? [],
      metaJson: {
        title: brief.title,
      },
      status: "pending_review",
    })
    .returning({ id: schema.drafts.id });
  const draftId = inserted[0]!.id;

  await recordEvent(
    {
      entityType: "draft",
      entityId: draftId,
      toStatus: "pending_review",
      note: `from brief=${briefId} channel=${brief.channel} format=${brief.format}`,
    },
    db,
  );

  return {
    draftId,
    briefId,
    channel: brief.channel,
    format: brief.format,
  };
}

function mapReelScript(s: NonNullable<Awaited<ReturnType<LLMProvider["generateDraft"]>>["script_json"]>) {
  return {
    hookScore: s.hook_score,
    targetDurationSec: s.target_duration_sec,
    coverImagePrompt: s.cover_image_prompt,
    shots: s.shots.map((sh) => ({
      index: sh.index,
      durationSec: sh.duration_sec,
      onScreenText: sh.on_screen_text,
      bRollNotes: sh.b_roll,
    })),
  };
}

/**
 * Apply user approval of a brief and fire draft generation. Caller (server
 * action) is responsible for input validation + user identity. The pipeline
 * ensures the state transition is legal and that draft creation is an event
 * recorded in `events`.
 */
export async function approveBriefAndGenerateDraft(
  briefId: string,
  deps: GenerateDraftDeps & { actor?: "user" | "system" } = {},
): Promise<GenerateDraftResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? (() => new Date());

  const rows = await db
    .select({ id: schema.briefs.id, status: schema.briefs.status })
    .from(schema.briefs)
    .where(eq(schema.briefs.id, briefId))
    .limit(1);
  const brief = rows[0];
  if (!brief) throw new Error(`Brief ${briefId} not found`);

  assertBriefTransition(brief.status, "approved");
  await db
    .update(schema.briefs)
    .set({ status: "approved", reviewedAt: now() })
    .where(eq(schema.briefs.id, briefId));
  await recordEvent(
    {
      entityType: "brief",
      entityId: briefId,
      fromStatus: brief.status,
      toStatus: "approved",
      actor: deps.actor ?? "user",
    },
    db,
  );

  return generateDraftForBrief(briefId, deps);
}

/** Schedule an approved+asset-attached draft → creates a `posts` row. */
export async function scheduleDraft(
  draftId: string,
  scheduledFor: Date,
  deps: GenerateDraftDeps = {},
): Promise<{ postId: string }> {
  const db = deps.db ?? defaultDb;
  const rows = await db
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.id, draftId))
    .limit(1);
  const draft = rows[0];
  if (!draft) throw new Error(`Draft ${draftId} not found`);

  assertDraftTransition(draft.status, "scheduled");

  const postRows = await db
    .insert(schema.posts)
    .values({
      draftId,
      brandId: draft.brandId,
      channel: draft.channel,
      status: "queued",
      scheduledFor,
    })
    .returning({ id: schema.posts.id });
  const postId = postRows[0]!.id;

  await db
    .update(schema.drafts)
    .set({ status: "scheduled" })
    .where(eq(schema.drafts.id, draftId));

  await recordEvent(
    {
      entityType: "draft",
      entityId: draftId,
      fromStatus: draft.status,
      toStatus: "scheduled",
      note: `post=${postId}`,
    },
    db,
  );
  await recordEvent(
    {
      entityType: "post",
      entityId: postId,
      toStatus: "queued",
      note: `scheduled_for=${scheduledFor.toISOString()}`,
    },
    db,
  );

  return { postId };
}

// Silence unused-import noise — we may want these for future SQL filters.
export const __internals = { and, desc, gte };
