import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Source-of-truth enum value arrays.
 * Exported as `as const` tuples so they can drive TypeScript unions and
 * Zod schemas without duplicating strings elsewhere.
 */

export const brandStatusValues = ["draft", "active", "archived"] as const;
export const brandStatusEnum = pgEnum("brand_status", brandStatusValues);
export type BrandStatus = (typeof brandStatusValues)[number];

export const channelValues = [
  "instagram",
  "facebook",
  "blog",
  "newsletter",
  "linkedin",
  "tiktok",
  "pinterest",
] as const;
export const channelEnum = pgEnum("channel", channelValues);
export type Channel = (typeof channelValues)[number];

export const competitorPlatformValues = [
  "ig",
  "fb",
  "web",
  "tiktok",
  "youtube",
  "other",
] as const;
export const competitorPlatformEnum = pgEnum(
  "competitor_platform",
  competitorPlatformValues,
);
export type CompetitorPlatform = (typeof competitorPlatformValues)[number];

export const formatValues = [
  "reel",
  "carousel",
  "image",
  "story",
  "post",
  "article",
  "email",
  "pin",
] as const;
export const formatEnum = pgEnum("content_format", formatValues);
export type ContentFormat = (typeof formatValues)[number];

export const keywordStatusValues = ["active", "paused"] as const;
export const keywordStatusEnum = pgEnum("keyword_status", keywordStatusValues);
export type KeywordStatus = (typeof keywordStatusValues)[number];

export const channelConnectionStatusValues = [
  "connected",
  "expired",
  "revoked",
  "error",
] as const;
export const channelConnectionStatusEnum = pgEnum(
  "channel_connection_status",
  channelConnectionStatusValues,
);
export type ChannelConnectionStatus =
  (typeof channelConnectionStatusValues)[number];

export const researchBundleStatusValues = [
  "fresh",
  "stale",
  "partial",
] as const;
export const researchBundleStatusEnum = pgEnum(
  "research_bundle_status",
  researchBundleStatusValues,
);
export type ResearchBundleStatus =
  (typeof researchBundleStatusValues)[number];

export const briefStatusValues = [
  "pending_review",
  "approved",
  "edited",
  "rejected",
] as const;
export const briefStatusEnum = pgEnum("brief_status", briefStatusValues);
export type BriefStatus = (typeof briefStatusValues)[number];

export const draftStatusValues = [
  "pending_review",
  "approved",
  "edited",
  "rejected",
  "awaiting_assets",
  "awaiting_final_review",
  "scheduled",
] as const;
export const draftStatusEnum = pgEnum("draft_status", draftStatusValues);
export type DraftStatus = (typeof draftStatusValues)[number];

export const assetKindValues = ["video", "image", "audio", "graphic"] as const;
export const assetKindEnum = pgEnum("asset_kind", assetKindValues);
export type AssetKind = (typeof assetKindValues)[number];

export const assetSourceValues = [
  "uploaded",
  "generated",
  "imported_from_post",
] as const;
export const assetSourceEnum = pgEnum("asset_source", assetSourceValues);
export type AssetSource = (typeof assetSourceValues)[number];

export const assetExternalSourceValues = ["drive", "dropbox"] as const;
export const assetExternalSourceEnum = pgEnum(
  "asset_external_source",
  assetExternalSourceValues,
);
export type AssetExternalSource =
  (typeof assetExternalSourceValues)[number];

export const draftAssetRoleValues = ["primary", "cover", "b_roll"] as const;
export const draftAssetRoleEnum = pgEnum(
  "draft_asset_role",
  draftAssetRoleValues,
);
export type DraftAssetRole = (typeof draftAssetRoleValues)[number];

export const postStatusValues = [
  "queued",
  "publishing",
  "published",
  "failed",
] as const;
export const postStatusEnum = pgEnum("post_status", postStatusValues);
export type PostStatus = (typeof postStatusValues)[number];

export const jobKindValues = [
  "research_pull",
  "brief_batch",
  "publish",
  "analytics_pull",
  "analytics_hot",
  "analytics_cold",
  "patterns",
  "jobs_retry",
] as const;
export const jobKindEnum = pgEnum("job_kind", jobKindValues);
export type JobKind = (typeof jobKindValues)[number];

export const jobStatusValues = ["queued", "running", "done", "failed"] as const;
export const jobStatusEnum = pgEnum("job_status", jobStatusValues);
export type JobStatus = (typeof jobStatusValues)[number];

export const eventActorValues = ["system", "user"] as const;
export const eventActorEnum = pgEnum("event_actor", eventActorValues);
export type EventActor = (typeof eventActorValues)[number];
