/**
 * Strongly-typed JSON shapes for jsonb columns.
 * Kept narrow; widen as the app evolves.
 */

// ---- brands.persona_json --------------------------------------------------
export interface Persona {
  mission?: string;
  audienceSummary?: string;
  archetype?: string;
  pointOfView?: string;
  traits?: string[];
}

// ---- brands.voice_json ----------------------------------------------------
export interface VoiceToneSliders {
  /** -100 (formal) ↔ +100 (casual) */
  formality?: number;
  /** -100 (serious) ↔ +100 (playful) */
  playfulness?: number;
  /** -100 (reserved) ↔ +100 (bold) */
  boldness?: number;
  /** -100 (technical) ↔ +100 (accessible) */
  accessibility?: number;
}

export type EmojiPolicy = "none" | "sparse" | "frequent";
export type HashtagStyle = "none" | "minimal" | "moderate" | "heavy";

export interface Voice {
  toneSliders?: VoiceToneSliders;
  emojiPolicy?: EmojiPolicy;
  hashtagStyle?: HashtagStyle;
  readingLevel?: string;
  bannedWords?: string[];
  signaturePhrases?: string[];
}

// ---- brands.voice_examples ------------------------------------------------
export interface VoiceExample {
  channel?: string;
  caption: string;
  notes?: string;
}

// ---- brands.settings_json -------------------------------------------------
export interface BrandSettings {
  llmProvider?: {
    default?: string;
    overrides?: Record<string, string>;
  };
  patterns?: unknown; // computed nightly; loose shape for now
  [key: string]: unknown;
}

// ---- channel_connections.meta_json ---------------------------------------
export interface ChannelConnectionMeta {
  fbPageId?: string;
  igBusinessId?: string;
  scopes?: string[];
  [key: string]: unknown;
}

// ---- research_bundles -----------------------------------------------------
export interface CompetitorFinding {
  competitorId: string;
  handle: string;
  topPosts: Array<{
    externalUrl: string;
    engagement?: number;
    caption?: string;
    publishedAt?: string;
  }>;
}

export interface KeywordFinding {
  keywordId: string;
  term: string;
  results: Array<{
    title: string;
    url: string;
    snippet?: string;
    rank: number;
  }>;
}

export interface TrendingHashtag {
  tag: string;
  frequency: number;
  weightedEngagement: number;
}

// ---- briefs ---------------------------------------------------------------
export interface InspirationPostRef {
  competitorId?: string;
  inspirationId?: string;
  externalUrl: string;
  why?: string;
}

// ---- drafts ---------------------------------------------------------------
export interface ReelShot {
  index: number;
  durationSec: number;
  onScreenText?: string;
  bRollNotes?: string;
  voiceover?: string;
}

export interface ReelScript {
  hook?: string;
  hookScore?: number;
  targetDurationSec?: number;
  shots: ReelShot[];
  coverImagePrompt?: string;
}

export interface CarouselSlide {
  index: number;
  copy: string;
  imagePrompt: string;
  styleHint?: string;
}

export interface DraftMeta {
  title?: string;
  subject?: string;
  [key: string]: unknown;
}

// ---- jobs -----------------------------------------------------------------
export type JobPayload = Record<string, unknown>;

// ---- analytics_snapshots.raw_json ----------------------------------------
export type AnalyticsRaw = Record<string, unknown>;
