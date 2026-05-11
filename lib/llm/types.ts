/**
 * LLM adapter types. Section 3 of foundation spec.
 *
 * NOTE: `Brief` and `Brand` are defined locally here until Task 2 (DB schemas)
 * lands. Once `lib/db/types` exports row types, replace the local definitions
 * with re-exports from there.
 */

export type Channel =
  | 'instagram'
  | 'facebook'
  | 'blog'
  | 'newsletter'
  | 'linkedin'
  | 'tiktok'
  | 'pinterest';

export type Format =
  | 'reel'
  | 'carousel'
  | 'image'
  | 'story'
  | 'post'
  | 'article'
  | 'email'
  | 'pin';

/** Persona fields stored on `brands.persona_json` (Section 5). */
export interface Persona {
  mission: string;
  audience_summary: string;
  archetype: string;
  pov: string;
  traits: string[];
}

/** Voice fields stored on `brands.voice_json` (Section 5). */
export interface Voice {
  tone_sliders?: Record<string, number>;
  emoji_policy?: 'none' | 'sparing' | 'liberal';
  hashtag_style?: 'none' | 'inline' | 'trailing' | 'block';
  reading_level?: string;
  banned_words?: string[];
  signature_phrases?: string[];
}

export interface VoiceExample {
  channel?: Channel;
  format?: Format;
  text: string;
  notes?: string;
}

/** Local Brand shape — replace with DB type when Task 2 lands. */
export interface Brand {
  id?: string;
  name?: string;
  persona_json: Persona;
  voice_json: Voice;
  voice_freeform: string;
  voice_examples: VoiceExample[];
}

export interface ResearchFindings {
  llm_pattern_summary?: string;
  competitor_findings_json?: unknown;
  keyword_findings_json?: unknown;
  trending_hashtags_json?: unknown;
}

export interface RejectionContext {
  briefOrDraft: 'brief' | 'draft';
  reason: string;
  at: string;
}

export interface BriefInput {
  persona: Persona;
  voice: Voice;
  icp: {
    name: string;
    description?: string;
    pain_points?: string[];
    where_they_hang_out?: string;
    content_they_engage_with?: string;
  };
  research: ResearchFindings;
  rejections: RejectionContext[];
  channel: Channel;
  format: Format;
  target_date: string; // ISO date
}

export interface InspirationRef {
  ref_id?: string;
  external_url?: string;
  why: string;
}

export interface BriefDraft {
  hook: string;
  angle: string;
  key_message: string;
  suggested_hashtags: string[];
  suggested_cta: string | null;
  inspiration_post_refs: InspirationRef[];
}

/** Local Brief shape — replace with DB type when Task 2 lands. */
export interface Brief {
  id?: string;
  brand_id?: string;
  channel: Channel;
  format: Format;
  title?: string;
  hook: string;
  angle: string;
  key_message: string;
  suggested_hashtags: string[];
  suggested_cta: string | null;
  inspiration_post_refs: InspirationRef[];
  target_publish_date?: string;
}

export interface ReelScript {
  shots: Array<{
    index: number;
    on_screen_text?: string;
    b_roll?: string;
    duration_sec: number;
  }>;
  target_duration_sec: number;
  hook_score?: number;
  cover_image_prompt?: string;
}

export interface CarouselSlides {
  slides: Array<{
    index: number;
    copy: string;
    image_prompt: string;
    style_hint?: string;
  }>;
}

export interface Draft {
  caption: string;
  body?: string | null;
  script_json?: ReelScript | null;
  slide_json?: CarouselSlides | null;
  image_prompts: string[];
}

export interface PersonaDraft {
  mission: string;
  audience_summary: string;
  archetype: string;
  pov: string;
  traits: string[];
}

export interface LLMProvider {
  generateBrief(input: BriefInput): Promise<BriefDraft>;
  generateDraft(brief: Brief, brand: Brand): Promise<Draft>;
  extractPersona(scrapedContent: string): Promise<PersonaDraft>;
  generateImagePrompts(slidesOrShots: unknown): Promise<string[]>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'missing_api_key'
      | 'api_error'
      | 'parse_error'
      | 'unknown',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
