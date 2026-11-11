import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  assetExternalSourceEnum,
  assetKindEnum,
  assetSourceEnum,
  brandStatusEnum,
  briefStatusEnum,
  channelConnectionStatusEnum,
  channelEnum,
  competitorPlatformEnum,
  draftAssetRoleEnum,
  draftStatusEnum,
  eventActorEnum,
  formatEnum,
  jobKindEnum,
  jobStatusEnum,
  keywordStatusEnum,
  postStatusEnum,
  researchBundleStatusEnum,
} from "./enums";
import { encryptedText } from "./crypto";
import type {
  AdCampaignRaw,
  AdInsightsRaw,
  AdRaw,
  AdSetRaw,
  AnalyticsRaw,
  BrandSettings,
  CarouselSlide,
  ChannelConnectionMeta,
  CompetitorFinding,
  DraftMeta,
  InspirationPostRef,
  JobPayload,
  KeywordFinding,
  Persona,
  ReelScript,
  TrendingHashtag,
  Voice,
  VoiceExample,
} from "./types";

// Re-export enums so consumers can `import { db, schema } from "@/lib/db"`.
export * from "./enums";

const ts = () => timestamp({ withTimezone: true }).defaultNow().notNull();
const tsNullable = () => timestamp({ withTimezone: true });

// =========================================================================
// Core: brand + brand-scoped configuration
// =========================================================================

export const brands = pgTable(
  "brands",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    slug: text().notNull(),
    status: brandStatusEnum().notNull().default("draft"),
    websiteUrl: text("website_url"),
    description: text().notNull().default(""),
    personaJson: jsonb("persona_json").$type<Persona>().notNull().default({}),
    voiceJson: jsonb("voice_json").$type<Voice>().notNull().default({}),
    voiceFreeform: text("voice_freeform").notNull().default(""),
    voiceExamples: jsonb("voice_examples")
      .$type<VoiceExample[]>()
      .notNull()
      .default([]),
    settingsJson: jsonb("settings_json")
      .$type<BrandSettings>()
      .notNull()
      .default({}),
    createdAt: ts(),
    updatedAt: ts(),
  },
  (t) => [uniqueIndex("brands_slug_unique").on(t.slug)],
);

export const icps = pgTable("icps", {
  id: uuid().primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  name: text().notNull(),
  description: text().notNull().default(""),
  painPoints: text("pain_points").array().notNull().default([]),
  whereTheyHangOut: text("where_they_hang_out").notNull().default(""),
  contentTheyEngageWith: text("content_they_engage_with")
    .notNull()
    .default(""),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: ts(),
  updatedAt: ts(),
});

export const competitors = pgTable("competitors", {
  id: uuid().primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  handle: text().notNull(),
  platform: competitorPlatformEnum().notNull(),
  url: text(),
  notes: text(),
  pullWindowDays: integer("pull_window_days").notNull().default(30),
  lastScrapedAt: tsNullable(),
  createdAt: ts(),
});

export const inspirationAccounts = pgTable("inspiration_accounts", {
  id: uuid().primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  handle: text().notNull(),
  platform: competitorPlatformEnum().notNull(),
  url: text(),
  notes: text(),
  pullWindowDays: integer("pull_window_days").notNull().default(30),
  lastScrapedAt: tsNullable(),
  createdAt: ts(),
});

export const keywords = pgTable("keywords", {
  id: uuid().primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  term: text().notNull(),
  status: keywordStatusEnum().notNull().default("active"),
  lastPulledAt: tsNullable(),
  createdAt: ts(),
});

export const channelConnections = pgTable(
  "channel_connections",
  {
    id: uuid().primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channel: channelEnum().notNull(),
    externalAccountId: text("external_account_id"),
    accessToken: encryptedText("access_token").notNull(),
    refreshToken: encryptedText("refresh_token"),
    tokenExpiresAt: tsNullable(),
    connectedAt: ts(),
    status: channelConnectionStatusEnum().notNull().default("connected"),
    metaJson: jsonb("meta_json")
      .$type<ChannelConnectionMeta>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex("channel_connections_brand_channel_unique").on(
      t.brandId,
      t.channel,
    ),
  ],
);

export const cadenceSettings = pgTable(
  "cadence_settings",
  {
    id: uuid().primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channel: channelEnum().notNull(),
    format: formatEnum().notNull(),
    perWeek: integer("per_week").notNull().default(0),
    enabled: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("cadence_settings_brand_channel_format_unique").on(
      t.brandId,
      t.channel,
      t.format,
    ),
  ],
);

// =========================================================================
// Pipeline: research → briefs → drafts → assets → posts → analytics
// =========================================================================

export const researchBundles = pgTable("research_bundles", {
  id: uuid().primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  pulledAt: ts(),
  competitorFindingsJson: jsonb("competitor_findings_json")
    .$type<CompetitorFinding[]>()
    .notNull()
    .default([]),
  keywordFindingsJson: jsonb("keyword_findings_json")
    .$type<KeywordFinding[]>()
    .notNull()
    .default([]),
  trendingHashtagsJson: jsonb("trending_hashtags_json")
    .$type<TrendingHashtag[]>()
    .notNull()
    .default([]),
  llmPatternSummary: text("llm_pattern_summary").notNull().default(""),
  status: researchBundleStatusEnum().notNull().default("fresh"),
  errorNotes: text("error_notes"),
});

export const briefs = pgTable("briefs", {
  id: uuid().primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  channel: channelEnum().notNull(),
  format: formatEnum().notNull(),
  icpId: uuid("icp_id").references(() => icps.id, { onDelete: "set null" }),
  researchBundleId: uuid("research_bundle_id").references(
    () => researchBundles.id,
    { onDelete: "set null" },
  ),
  title: text().notNull(),
  hook: text().notNull().default(""),
  angle: text().notNull().default(""),
  keyMessage: text("key_message").notNull().default(""),
  suggestedHashtags: text("suggested_hashtags").array().notNull().default([]),
  suggestedCta: text("suggested_cta"),
  inspirationPostRefs: jsonb("inspiration_post_refs")
    .$type<InspirationPostRef[]>()
    .notNull()
    .default([]),
  targetPublishDate: date("target_publish_date"),
  status: briefStatusEnum().notNull().default("pending_review"),
  rejectionReason: text("rejection_reason"),
  createdAt: ts(),
  reviewedAt: tsNullable(),
});

export const drafts = pgTable(
  "drafts",
  {
    id: uuid().primaryKey().defaultRandom(),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => briefs.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channel: channelEnum().notNull(),
    format: formatEnum().notNull(),
    caption: text().notNull().default(""),
    body: text(),
    scriptJson: jsonb("script_json").$type<ReelScript>(),
    slideJson: jsonb("slide_json").$type<CarouselSlide[]>(),
    imagePrompts: jsonb("image_prompts")
      .$type<string[]>()
      .notNull()
      .default([]),
    metaJson: jsonb("meta_json").$type<DraftMeta>().notNull().default({}),
    status: draftStatusEnum().notNull().default("pending_review"),
    rejectionReason: text("rejection_reason"),
    createdAt: ts(),
    reviewedAt: tsNullable(),
  },
  (t) => [uniqueIndex("drafts_brief_unique").on(t.briefId)],
);

export const assets = pgTable("assets", {
  id: uuid().primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  kind: assetKindEnum().notNull(),
  label: text().notNull().default(""),
  tags: text().array().notNull().default([]),
  storageUrl: text("storage_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  durationSec: integer("duration_sec"),
  width: integer(),
  height: integer(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  source: assetSourceEnum().notNull().default("uploaded"),
  notes: text(),
  archived: boolean().notNull().default(false),
  externalSource: assetExternalSourceEnum("external_source"),
  externalId: text("external_id"),
  externalModifiedAt: tsNullable(),
  syncedAt: tsNullable(),
  createdAt: ts(),
});

export const draftAssets = pgTable(
  "draft_assets",
  {
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    slotIndex: integer("slot_index").notNull(),
    role: draftAssetRoleEnum().notNull().default("primary"),
    addedAt: ts(),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.assetId, t.slotIndex] }),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid().primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "restrict" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channel: channelEnum().notNull(),
    status: postStatusEnum().notNull().default("queued"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    publishedAt: tsNullable(),
    externalPostId: text("external_post_id"),
    externalUrl: text("external_url"),
    publishError: text("publish_error"),
    publishAttempts: integer("publish_attempts").notNull().default(0),
    lastErrorAt: tsNullable(),
    externalContainerId: text("external_container_id"),
    createdAt: ts(),
    updatedAt: ts(),
  },
  (t) => [uniqueIndex("posts_draft_unique").on(t.draftId)],
);

export const analyticsSnapshots = pgTable("analytics_snapshots", {
  id: uuid().primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  pulledAt: ts(),
  reach: integer(),
  impressions: integer(),
  likes: integer(),
  comments: integer(),
  shares: integer(),
  saves: integer(),
  watchTimeSec: integer("watch_time_sec"),
  videoViews: integer("video_views"),
  profileVisits: integer("profile_visits"),
  followsFromPost: integer("follows_from_post"),
  opens: integer(),
  clicks: integer(),
  pageviews: integer(),
  dwellSec: integer("dwell_sec"),
  rawJson: jsonb("raw_json").$type<AnalyticsRaw>().notNull().default({}),
});

export const brandMetricsSnapshots = pgTable("brand_metrics_snapshots", {
  id: uuid().primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  channel: channelEnum().notNull(),
  pulledAt: ts(),
  followerCount: integer("follower_count"),
  followingCount: integer("following_count"),
  totalPosts: integer("total_posts"),
  rawJson: jsonb("raw_json").$type<AnalyticsRaw>().notNull().default({}),
});

// =========================================================================
// Support: jobs queue + audit events
// =========================================================================

export const jobs = pgTable("jobs", {
  id: uuid().primaryKey().defaultRandom(),
  kind: jobKindEnum().notNull(),
  brandId: uuid("brand_id").references(() => brands.id, {
    onDelete: "cascade",
  }),
  payloadJson: jsonb("payload_json").$type<JobPayload>().notNull().default({}),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: tsNullable(),
  completedAt: tsNullable(),
  status: jobStatusEnum().notNull().default("queued"),
  attempts: integer().notNull().default(0),
  lastError: text("last_error"),
});

export const events = pgTable("events", {
  id: uuid().primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  actor: eventActorEnum().notNull().default("system"),
  note: text(),
  at: ts(),
});

// =========================================================================
// Paid: Meta Marketing API — campaign / adset / ad metadata + insights
// =========================================================================
//
// Identity model:
//   - campaign / adset / ad ids are Meta's own string ids (NOT uuids). We store
//     them as TEXT primary keys so upserts are trivial and idempotent.
//   - ad_account_id is the "act_…" string. We do NOT make it a FK because a
//     single ad account can be shared across brands (e.g. Business Manager).
//     Instead we tag every row with brand_id derived from the channel_connection
//     that ingested it; if the same ad account is later wired to a second brand,
//     the next ingest just rewrites the brand_id (single-user assumption).

export const adCampaigns = pgTable(
  "ad_campaigns",
  {
    id: text().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    adAccountId: text("ad_account_id").notNull(),
    name: text().notNull().default(""),
    /** ODAX values for new campaigns (OUTCOME_*); legacy values on historical rows. */
    objective: text(),
    /** What the advertiser set: ACTIVE / PAUSED / DELETED / ARCHIVED. */
    status: text(),
    /** Actual delivery state incl. IN_PROCESS / WITH_ISSUES / PENDING_REVIEW etc. */
    effectiveStatus: text("effective_status"),
    buyingType: text("buying_type"),
    /** Normalized to major currency units (dollars) — see lib/pipelines/ads.ts. */
    dailyBudget: numeric("daily_budget"),
    lifetimeBudget: numeric("lifetime_budget"),
    startTime: tsNullable(),
    stopTime: tsNullable(),
    rawJson: jsonb("raw_json").$type<AdCampaignRaw>().notNull().default({}),
    refreshedAt: ts(),
  },
  (t) => [index("ad_campaigns_brand_idx").on(t.brandId)],
);

export const adSets = pgTable(
  "ad_sets",
  {
    id: text().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    adAccountId: text("ad_account_id").notNull(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => adCampaigns.id, { onDelete: "cascade" }),
    name: text().notNull().default(""),
    status: text(),
    effectiveStatus: text("effective_status"),
    optimizationGoal: text("optimization_goal"),
    billingEvent: text("billing_event"),
    /** Normalized to major currency units (dollars). */
    dailyBudget: numeric("daily_budget"),
    lifetimeBudget: numeric("lifetime_budget"),
    startTime: tsNullable(),
    endTime: tsNullable(),
    rawJson: jsonb("raw_json").$type<AdSetRaw>().notNull().default({}),
    refreshedAt: ts(),
  },
  (t) => [
    index("ad_sets_brand_idx").on(t.brandId),
    index("ad_sets_campaign_idx").on(t.campaignId),
  ],
);

export const ads = pgTable(
  "ads",
  {
    id: text().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    adAccountId: text("ad_account_id").notNull(),
    adsetId: text("adset_id")
      .notNull()
      .references(() => adSets.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => adCampaigns.id, { onDelete: "cascade" }),
    name: text().notNull().default(""),
    status: text(),
    effectiveStatus: text("effective_status"),
    creativeId: text("creative_id"),
    /**
     * For FB Page boosted posts: `{page_id}_{fb_post_id}` — matches
     * `posts.external_post_id` directly (FB join is free).
     *
     * For IG boosted posts: a Page-side dark-post id `{page_id}_{dark_post_id}`,
     * NOT the IG media id. To join IG ads to organic IG posts, parse the
     * shortcode out of `instagramPermalinkUrl` and match against the
     * permalink stored on the source IG post.
     */
    effectiveObjectStoryId: text("effective_object_story_id"),
    instagramPermalinkUrl: text("instagram_permalink_url"),
    creativeThumbnailUrl: text("creative_thumbnail_url"),
    creativeBody: text("creative_body"),
    rawJson: jsonb("raw_json").$type<AdRaw>().notNull().default({}),
    refreshedAt: ts(),
  },
  (t) => [
    index("ads_brand_idx").on(t.brandId),
    index("ads_adset_idx").on(t.adsetId),
    index("ads_eosi_idx").on(t.effectiveObjectStoryId),
    index("ads_ig_permalink_idx").on(t.instagramPermalinkUrl),
  ],
);

/**
 * Daily ad-level insights. Time series — UPSERT per (ad_id, day) so re-runs
 * of the cron over the trailing window are idempotent.
 *
 * `spend`, `ctr`, `cpc`, `cpm`, `cpp`, `frequency` are returned as strings by
 * Meta — we store as numeric to preserve precision and avoid float drift.
 */
export const adInsights = pgTable(
  "ad_insights",
  {
    id: uuid().primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    adAccountId: text("ad_account_id").notNull(),
    adId: text("ad_id")
      .notNull()
      .references(() => ads.id, { onDelete: "cascade" }),
    adsetId: text("adset_id").notNull(),
    campaignId: text("campaign_id").notNull(),
    day: date().notNull(),
    spend: numeric(),
    impressions: integer(),
    reach: integer(),
    frequency: numeric(),
    clicks: integer(),
    uniqueClicks: integer("unique_clicks"),
    inlineLinkClicks: integer("inline_link_clicks"),
    outboundClicks: integer("outbound_clicks"),
    ctr: numeric(),
    cpc: numeric(),
    cpm: numeric(),
    cpp: numeric(),
    pulledAt: ts(),
    rawJson: jsonb("raw_json").$type<AdInsightsRaw>().notNull().default({}),
  },
  (t) => [
    uniqueIndex("ad_insights_ad_day_unique").on(t.adId, t.day),
    index("ad_insights_brand_day_idx").on(t.brandId, t.day),
    index("ad_insights_account_day_idx").on(t.adAccountId, t.day),
  ],
);
