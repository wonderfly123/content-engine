CREATE TYPE "public"."asset_external_source" AS ENUM('drive', 'dropbox');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('video', 'image', 'audio', 'graphic');--> statement-breakpoint
CREATE TYPE "public"."asset_source" AS ENUM('uploaded', 'generated', 'imported_from_post');--> statement-breakpoint
CREATE TYPE "public"."brand_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."brief_status" AS ENUM('pending_review', 'approved', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."channel_connection_status" AS ENUM('connected', 'expired', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('instagram', 'facebook', 'blog', 'newsletter', 'linkedin', 'tiktok', 'pinterest');--> statement-breakpoint
CREATE TYPE "public"."competitor_platform" AS ENUM('ig', 'fb', 'web', 'tiktok', 'youtube', 'other');--> statement-breakpoint
CREATE TYPE "public"."draft_asset_role" AS ENUM('primary', 'cover', 'b_roll');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('pending_review', 'approved', 'edited', 'rejected', 'awaiting_assets', 'awaiting_final_review', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."event_actor" AS ENUM('system', 'user');--> statement-breakpoint
CREATE TYPE "public"."content_format" AS ENUM('reel', 'carousel', 'image', 'story', 'post', 'article', 'email', 'pin');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('research_pull', 'brief_batch', 'publish', 'analytics_pull', 'analytics_hot', 'analytics_cold', 'patterns', 'jobs_retry');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."keyword_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('queued', 'publishing', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."research_bundle_status" AS ENUM('fresh', 'stale', 'partial');--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"pulledAt" timestamp with time zone DEFAULT now() NOT NULL,
	"reach" integer,
	"impressions" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"watch_time_sec" integer,
	"video_views" integer,
	"profile_visits" integer,
	"follows_from_post" integer,
	"opens" integer,
	"clicks" integer,
	"pageviews" integer,
	"dwell_sec" integer,
	"raw_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"storage_url" text NOT NULL,
	"thumbnail_url" text,
	"duration_sec" integer,
	"width" integer,
	"height" integer,
	"mime_type" text,
	"size_bytes" integer,
	"source" "asset_source" DEFAULT 'uploaded' NOT NULL,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"external_source" "asset_external_source",
	"external_id" text,
	"externalModifiedAt" timestamp with time zone,
	"syncedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_metrics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"pulledAt" timestamp with time zone DEFAULT now() NOT NULL,
	"follower_count" integer,
	"following_count" integer,
	"total_posts" integer,
	"raw_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "brand_status" DEFAULT 'draft' NOT NULL,
	"website_url" text,
	"description" text DEFAULT '' NOT NULL,
	"persona_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voice_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voice_freeform" text DEFAULT '' NOT NULL,
	"voice_examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"format" "content_format" NOT NULL,
	"icp_id" uuid,
	"research_bundle_id" uuid,
	"title" text NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"angle" text DEFAULT '' NOT NULL,
	"key_message" text DEFAULT '' NOT NULL,
	"suggested_hashtags" text[] DEFAULT '{}' NOT NULL,
	"suggested_cta" text,
	"inspiration_post_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_publish_date" date,
	"status" "brief_status" DEFAULT 'pending_review' NOT NULL,
	"rejection_reason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cadence_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"format" "content_format" NOT NULL,
	"per_week" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_account_id" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"tokenExpiresAt" timestamp with time zone,
	"connectedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "channel_connection_status" DEFAULT 'connected' NOT NULL,
	"meta_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"platform" "competitor_platform" NOT NULL,
	"url" text,
	"notes" text,
	"pull_window_days" integer DEFAULT 30 NOT NULL,
	"lastScrapedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_assets" (
	"draft_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"slot_index" integer NOT NULL,
	"role" "draft_asset_role" DEFAULT 'primary' NOT NULL,
	"addedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_assets_draft_id_asset_id_slot_index_pk" PRIMARY KEY("draft_id","asset_id","slot_index")
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"format" "content_format" NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"body" text,
	"script_json" jsonb,
	"slide_json" jsonb,
	"image_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "draft_status" DEFAULT 'pending_review' NOT NULL,
	"rejection_reason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor" "event_actor" DEFAULT 'system' NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"pain_points" text[] DEFAULT '{}' NOT NULL,
	"where_they_hang_out" text DEFAULT '' NOT NULL,
	"content_they_engage_with" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspiration_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"platform" "competitor_platform" NOT NULL,
	"url" text,
	"notes" text,
	"pull_window_days" integer DEFAULT 30 NOT NULL,
	"lastScrapedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "job_kind" NOT NULL,
	"brand_id" uuid,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"term" text NOT NULL,
	"status" "keyword_status" DEFAULT 'active' NOT NULL,
	"lastPulledAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "post_status" DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"publishedAt" timestamp with time zone,
	"external_post_id" text,
	"external_url" text,
	"publish_error" text,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"lastErrorAt" timestamp with time zone,
	"external_container_id" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"pulledAt" timestamp with time zone DEFAULT now() NOT NULL,
	"competitor_findings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keyword_findings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trending_hashtags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"llm_pattern_summary" text DEFAULT '' NOT NULL,
	"status" "research_bundle_status" DEFAULT 'fresh' NOT NULL,
	"error_notes" text
);
--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_metrics_snapshots" ADD CONSTRAINT "brand_metrics_snapshots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_research_bundle_id_research_bundles_id_fk" FOREIGN KEY ("research_bundle_id") REFERENCES "public"."research_bundles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_settings" ADD CONSTRAINT "cadence_settings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_assets" ADD CONSTRAINT "draft_assets_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_assets" ADD CONSTRAINT "draft_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icps" ADD CONSTRAINT "icps_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_accounts" ADD CONSTRAINT "inspiration_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_bundles" ADD CONSTRAINT "research_bundles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_unique" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cadence_settings_brand_channel_format_unique" ON "cadence_settings" USING btree ("brand_id","channel","format");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_brand_channel_unique" ON "channel_connections" USING btree ("brand_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_brief_unique" ON "drafts" USING btree ("brief_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_draft_unique" ON "posts" USING btree ("draft_id");