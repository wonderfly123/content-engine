/**
 * Strongly-typed JSON shapes for jsonb columns.
 * Kept narrow; widen as the app evolves.
 */

import type { Channel } from "./enums";

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

/** A real place, product, offer or name the editor may mention, with where it was found. */
export interface BrandFact {
  fact: string;
  /** The page it came from, "captions", "your description", or "added by you". */
  source?: string;
}

export interface Voice {
  toneSliders?: VoiceToneSliders;
  emojiPolicy?: EmojiPolicy;
  hashtagStyle?: HashtagStyle;
  readingLevel?: string;
  bannedWords?: string[];
  signaturePhrases?: string[];
  /** Brand facts set up in onboarding; the editor may use these and must not invent others. */
  facts?: BrandFact[];
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
  /**
   * Channels shown in analytics. Absent/undefined = all channels enabled
   * (backward compatible); present = only the listed channels are included
   * in analytics queries and the analytics channel filter.
   */
  enabledChannels?: Channel[];
  [key: string]: unknown;
}

// ---- channel_connections.meta_json ---------------------------------------
export interface ConnectedAdAccount {
  /** Meta ad account id, "act_" prefixed (e.g. "act_123456…"). */
  id: string;
  name: string;
  currency?: string;
  /** Meta numeric account_status (1=ACTIVE, 2=DISABLED, 3=UNSETTLED, …). */
  accountStatus?: number;
  businessId?: string;
  businessName?: string;
}

export interface ChannelConnectionMeta {
  fbPageId?: string;
  igBusinessId?: string;
  scopes?: string[];
  /** Currently-selected ad account for this brand (read-only paid insights). */
  adAccountId?: string; // "act_…"
  adAccountName?: string;
  adAccountCurrency?: string;
  adAccountBusinessId?: string;
  /** All ad accounts visible to the granting user at the time of OAuth. */
  adAccounts?: ConnectedAdAccount[];
  [key: string]: unknown;
}

// ---- ads: campaign / adset / ad metadata + insights ----------------------
export type AdCampaignRaw = Record<string, unknown>;
export type AdSetRaw = Record<string, unknown>;
export type AdRaw = Record<string, unknown>;
export type AdInsightsRaw = Record<string, unknown>;

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
