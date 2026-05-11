# Content Engine — Foundation + Instagram Vertical Slice

**Date:** 2026-05-08
**Status:** Design — approved by user, pending spec review
**Scope:** Foundation infrastructure + end-to-end Instagram pipeline. Facebook publish piggybacks IG. All other channels (Blog, Newsletter, LinkedIn, TikTok, Pinterest) and ICP engagement are schema-stubbed and UI-deferred.

---

## 1. Purpose

Build a single-user, multi-brand content engine that automates research → brief → draft → asset upload → schedule → publish → analytics for Instagram (and Facebook), with a roadmap to add additional channels behind the same shared backbone.

The user (Jordan) operates multiple brands (e.g., Wonderfly, personal woodworking, additional companies). Each brand has its own persona, voice, ICP, competitors, inspiration accounts, social connections, cadence, and analytics. Switching brands in the UI switches the active workspace.

The engine's value is not "post things" — that's commodity. The value is the **research → brief → draft pipeline that learns from your rejections and your top-performing posts**, so that briefs improve over time and the system surfaces winning patterns automatically.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| App framework | Next.js 16 (App Router) | Per dashboard-reusable-template |
| UI | React 19 + Tailwind v4 + shadcn/ui (Radix) + lucide-react | Per template |
| State | Zustand (UI state), TanStack Query (server state) | Per template |
| Database | Neon (Postgres serverless) | Replaces Supabase from template |
| ORM | Drizzle + drizzle-kit migrations | Typesafe, Neon-native |
| File storage | Vercel Blob | Direct browser uploads via signed URLs |
| Hosting | Vercel (**Pro plan required**) | Hobby limits crons to daily; we need 5-min/hourly schedules |
| Scheduling | Vercel Cron | Declared in `vercel.json` |
| LLM | Anthropic Claude (default; Sonnet 4.6 for most tasks, Opus 4.7 for nuanced voice work) | Behind `LLMProvider` interface — swappable |
| Web scraping | Firecrawl | Brand onboarding, keyword SERP, site change detection |
| Social scraping | Apify | Competitor + inspiration IG post pulls (last 30 days) |
| Publishing | Direct Meta Graph API | IG Business/Creator + FB Pages |
| Auth | None (HTTP Basic Auth at edge middleware, single shared password env var) | Single-user app |

**Template adoption:**

- **Keep:** `components/layout/*`, `lib/stores/sidebar-store.ts`, `lib/theme/*`, `lib/utils.ts`, `app/globals.css`, `app/layout.tsx`, `app/providers.tsx` (sans AuthProvider), all `components/ui/*`
- **Drop:** all `lib/auth/*`, `lib/supabase/*`, `app/login/*`, `app/complete-profile/*`, `app/admin/*`, `app/api/admin/*`, `components/auth/*`, `components/user-menu.tsx`
- **Add:** Drizzle config, `lib/db/*`, `lib/llm/*`, `lib/research/*`, `lib/publishing/*`, `middleware.ts` for basic auth

---

## 3. High-Level Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │           Next.js 16 App (Vercel)               │
                    │                                                 │
   Browser ───────► │  Pages (RSC)  ┐  API Routes  ┐  Server Actions │
   (Basic Auth)     │              ────────┬─────────                 │
                    │                      │                           │
                    │              ┌───────▼────────┐                  │
                    │              │ Service Layer  │                  │
                    │              └───────┬────────┘                  │
                    │       ┌──────┬──────┴──────┬──────┐              │
                    │   ┌───▼──┐┌──▼───┐ ┌────▼─┐┌────▼──┐             │
                    │   │ LLM  ││ Pub- │ │ Re-  ││ Scrape│             │
                    │   │ adp. ││lisher│ │search││  adp. │             │
                    │   └───┬──┘└──┬───┘ └──┬───┘└───┬───┘             │
                    │       │      │         │        │                │
                    │   Anthropic Meta    Firecrawl  Apify             │
                    │              Graph                                │
                    │                                                   │
                    │   Drizzle ORM ──► Neon Postgres                  │
                    │   Vercel Cron ──► reads/writes `jobs` table     │
                    │   Vercel Blob ◄── browser direct uploads        │
                    └───────────────────────────────────────────────────┘
```

**Adapter pattern** for every external integration. Service layer never imports SDKs directly:

```ts
interface LLMProvider {
  generateBrief(input: BriefInput): Promise<BriefDraft>;
  generateDraft(brief: Brief, brand: Brand): Promise<Draft>;
  extractPersona(scrapedContent: string): Promise<PersonaDraft>;
  generateImagePrompts(slidesOrShots: unknown): Promise<string[]>;
}

interface Publisher {
  connect(brandId: string): Promise<ChannelConnection>;
  publish(post: Post, assets: Asset[]): Promise<{ externalId: string; url: string }>;
  fetchAnalytics(externalId: string): Promise<AnalyticsSnapshot>;
  refreshToken(connection: ChannelConnection): Promise<ChannelConnection>;
}

interface Researcher {
  scrapeSite(url: string): Promise<ScrapedSite>;
  searchKeyword(keyword: string): Promise<SerpResult[]>;
}

interface CompetitorScraper {
  fetchRecentPosts(handle: string, sinceDays: number): Promise<CompetitorPost[]>;
}
```

---

## 4. Page Structure

```
[Brand Switcher ▼]  ← top of sidebar; switches active brand in URL + state
─────────────────────
🏠 Home              ← cross-brand totals (visible only when no brand selected)
─────────────────────
Active Brand workspace:
📊 Dashboard         ← today's queue, this week's calendar preview, alerts
🔬 Research          ← latest research bundle, competitor patterns, keywords panel
📝 Briefs            ← weekly batch, approve/edit/reject queue
✏️  Drafts           ← copy + script awaiting approval
📦 Assets            ← Library + Pending uploads tabs
📅 Calendar          ← month/week views, drag-to-reschedule
📈 Analytics         ← unified live view with filters; post drill-down
─── Channels ───
📷 Instagram         ← per-channel pipeline view (filters Briefs/Drafts/etc. to IG)
👥 Facebook          ← per-channel pipeline view
✍️  Blog              ← greyed (schema-stubbed)
📧 Newsletter        ← greyed
💼 LinkedIn          ← greyed
🎵 TikTok            ← greyed
📌 Pinterest         ← greyed
─────────────────────
⚙️  Settings          ← tabbed: App + Brand (Persona, Voice, ICPs, Competitors,
                       Inspiration, Keywords, Cadence, Channels, Integrations)
➕ Add Brand
```

**Two views, one data set.** Workflow-first pages (Briefs, Drafts, Assets, Calendar) show all channels filtered by stage. Channel-first pages (Instagram, Facebook) show all stages filtered by channel. Same tables, different filter param.

---

## 5. Data Model

### Core tables

```
brands
├── id (uuid, pk), name, slug (unique), status (draft|active|archived)
├── website_url (nullable text)
├── description (text)
├── persona_json (jsonb)        — mission, audience summary, archetype, POV, traits
├── voice_json (jsonb)          — tone sliders, emoji policy, hashtag style, reading level,
│                                  banned words, signature phrases
├── voice_freeform (text)       — LLM-drafted, user-edited voice description
├── voice_examples (jsonb)      — array of 3-5 example post objects
├── settings_json (jsonb)       — per-brand LLM provider override, etc.
├── created_at, updated_at

icps
├── id, brand_id (fk), name, description (text)
├── pain_points (text[])
├── where_they_hang_out (text)
├── content_they_engage_with (text)
├── is_default (bool)
├── created_at, updated_at

competitors
├── id, brand_id (fk), handle, platform (ig|fb|web|tiktok|youtube|other)
├── url (nullable), notes (nullable)
├── pull_window_days (int, default 30)
├── last_scraped_at (nullable timestamptz)
├── created_at

inspiration_accounts
├── id, brand_id (fk), handle, platform, url, notes
├── pull_window_days (int, default 30)
├── last_scraped_at
├── created_at

keywords
├── id, brand_id (fk), term, status (active|paused)
├── last_pulled_at, created_at

channel_connections
├── id, brand_id (fk), channel (enum: instagram|facebook|blog|newsletter|linkedin|tiktok|pinterest)
├── external_account_id (e.g., IG business id, FB page id)
├── access_token (encrypted text), refresh_token (encrypted text, nullable)
├── token_expires_at (nullable timestamptz)
├── connected_at, status (connected|expired|revoked|error)
├── meta_json (jsonb)  — channel-specific fields (e.g., FB page id linked to IG)
├── unique (brand_id, channel)

cadence_settings
├── id, brand_id (fk), channel, format (reel|carousel|image|story|post|article|email|pin)
├── per_week (int, default 0)
├── enabled (bool, default true)
├── unique (brand_id, channel, format)
```

### Pipeline tables

```
research_bundles
├── id, brand_id (fk), pulled_at (timestamptz)
├── competitor_findings_json (jsonb)
├── keyword_findings_json (jsonb)
├── trending_hashtags_json (jsonb)
├── llm_pattern_summary (text)
├── status (fresh|stale|partial), error_notes (nullable text)

briefs
├── id, brand_id (fk), channel, format, icp_id (fk, nullable)
├── research_bundle_id (fk, nullable)
├── title, hook, angle (text), key_message (text)
├── suggested_hashtags (text[]), suggested_cta (text, nullable)
├── inspiration_post_refs (jsonb)  — [{competitor_id|inspiration_id, external_url, why}]
├── target_publish_date (date)
├── status (pending_review|approved|edited|rejected)
├── rejection_reason (text, nullable)
├── created_at, reviewed_at (nullable)

drafts
├── id, brief_id (fk, unique), brand_id (fk, denormalized), channel, format
├── caption (text), body (text, nullable for long-form)
├── script_json (jsonb)  — Reels: shot list w/ on-screen text, b-roll, durations
├── slide_json (jsonb)   — Carousels: per-slide copy + image prompt + style hint
├── image_prompts (jsonb) — array of generated image prompts
├── meta_json (jsonb)    — title for blog, subject for email, etc.
├── status (pending_review|approved|edited|rejected|awaiting_assets|awaiting_final_review|scheduled)
├── rejection_reason (text, nullable)
├── created_at, reviewed_at

assets                                  — brand-scoped LIBRARY
├── id, brand_id (fk), kind (video|image|audio|graphic)
├── label (text), tags (text[])
├── storage_url (text)                  — Vercel Blob URL
├── thumbnail_url (text, nullable)
├── duration_sec, width, height, mime_type, size_bytes
├── source (uploaded|generated|imported_from_post)
├── notes (text, nullable)
├── archived (bool, default false)
├── external_source (drive|dropbox|null) — reserved for future Drive sync
├── external_id (nullable)               — reserved
├── external_modified_at (nullable)      — reserved
├── synced_at (nullable)                 — reserved
├── created_at

draft_assets                            — JOIN
├── draft_id (fk), asset_id (fk)
├── slot_index (int)                    — order in carousel; 0 for primary in single/Reel
├── role (primary|cover|b_roll)
├── added_at
├── pk (draft_id, asset_id, slot_index)

posts
├── id, draft_id (fk, unique), brand_id (fk, denormalized), channel
├── status (queued|publishing|published|failed)
├── scheduled_for (timestamptz)
├── published_at (nullable)
├── external_post_id (text, nullable)   — IG media id, FB post id
├── external_url (text, nullable)
├── publish_error (text, nullable)
├── publish_attempts (int, default 0)
├── last_error_at (timestamptz, nullable)
├── external_container_id (text, nullable)  — IG container id during async publish
├── created_at, updated_at

analytics_snapshots                     — TIME SERIES (one row per pull)
├── id, post_id (fk), brand_id (fk, denormalized), pulled_at
├── reach, impressions, likes, comments, shares, saves (int, nullable)
├── watch_time_sec, video_views (int, nullable)
├── profile_visits, follows_from_post (int, nullable)
├── opens, clicks (int, nullable)        — newsletter
├── pageviews, dwell_sec (int, nullable) — blog
├── raw_json (jsonb)                     — full API payload

brand_metrics_snapshots                 — TIME SERIES brand-level
├── id, brand_id (fk), channel, pulled_at
├── follower_count, following_count, total_posts (int)
├── raw_json
```

### Support tables

```
jobs                                    — work queue + audit
├── id, kind (research_pull|brief_batch|publish|analytics_pull|...)
├── brand_id (nullable for app-wide jobs)
├── payload_json (jsonb)
├── scheduled_for, started_at, completed_at
├── status (queued|running|done|failed)
├── attempts (int), last_error (text, nullable)

events                                  — audit log
├── id, entity_type (brief|draft|post|asset|brand|...)
├── entity_id (uuid)
├── from_status, to_status (text, nullable)
├── actor (system|user)
├── note (text, nullable)
├── at (timestamptz)
```

### Relationships diagram

```
brand ─┬─► icps (1-3)
       ├─► competitors (many)
       ├─► inspiration_accounts (many)
       ├─► keywords (many)
       ├─► channel_connections (one per channel)
       ├─► cadence_settings (one per channel/format)
       ├─► assets (library, many)
       ├─► brand_metrics_snapshots (many over time)
       └─► research_bundles (weekly)
              │
              └─► briefs (~7/week)
                     │
                     └─► drafts (1:1 on approval)
                            ├─► draft_assets ──► assets
                            └─► posts (1:1 on schedule)
                                   │
                                   └─► analytics_snapshots (many over time)
```

### Encryption

`channel_connections.access_token` and `refresh_token` encrypted at rest using AES-256-GCM with a key from a Vercel env var (`TOKEN_ENCRYPTION_KEY`). Implemented as Drizzle column transformers so reads/writes are transparent.

### RLS / authz

No multi-user → no row-level authz needed. Edge middleware enforces basic auth before any request reaches handlers. All DB queries scope by `brand_id` from active brand state (sidebar switcher) — brand isolation in queries, not DB.

---

## 6. Pipelines

### Pipeline 1: Research (weekly per brand)

**Trigger:** Vercel Cron, every Sunday 18:00 UTC. Manual override via "Refresh research" button on Research page.

**Steps:**
1. Pull competitor IG posts via Apify, last 30 days (per `competitors.pull_window_days`), top by engagement
2. Scrape competitor websites via Firecrawl (homepage + blog), diff vs prior bundle for new content
3. For each active keyword: Firecrawl SERP search, capture top 5 organic + featured-snippet
4. Aggregate trending hashtags from competitor posts (frequency × engagement-weighted)
5. LLM pattern extraction (Claude Sonnet): summarize "what's working" — hooks, formats, themes, lengths
6. Insert one `research_bundles` row with all findings + `llm_pattern_summary`

**Output:** one fresh research bundle per brand per week.

**Failure:** partial data → bundle status `partial`, briefs still generated but flagged lower-confidence.

### Pipeline 2: Brief batch (weekly per brand)

**Trigger:** Vercel Cron, every Monday 07:00 UTC (one day after research). Manual: "Generate more briefs" button on Briefs page.

**Steps:**
1. Read fresh `research_bundle` for brand
2. Read brand persona + voice + ICPs
3. Read `cadence_settings` for the brand → compute slot count per channel/format (e.g., 5 IG Reel + 2 IG Carousel = 7 slots)
4. Read recent rejections (last 30 days) for this brand → "user rejected because..." context bundle
5. For each slot, prompt Claude Opus with full context (persona, voice, ICP, research findings, rejections, format constraints, target publish date spread across the week)
6. Insert `briefs` row per slot, status `pending_review`

**Output:** N briefs (sum of all `cadence_settings.per_week` for brand) waiting in Briefs queue.

### Pipeline 3: Draft generation (event-driven)

**Trigger:** server action when user approves a brief (or saves edits + approves).

**Steps:**
1. Read approved brief + brand voice + linked ICP
2. Read 3-5 voice example posts (few-shot)
3. Read recent draft rejections for context
4. Generate channel-specific deliverable:
   - **IG Reel** → caption + `script_json` (shot list, on-screen text, b-roll notes, target duration, hook score) + cover image prompt
   - **IG Carousel** → caption + `slide_json` (per-slide copy + image prompt + style hint)
   - **IG Image** → caption + image prompt
   - **FB Post** → piggybacks IG draft for same brief (caption may be lightly adapted for FB tone)
5. Insert `drafts` row, status `pending_review`

### Pipeline 4: Asset upload (manual, per draft)

**Steps:**
1. Browser requests signed upload URL: `POST /api/assets/upload-url` with `{kind, brand_id}` → returns Vercel Blob signed PUT URL
2. Browser uploads bytes directly to Blob (no proxying)
3. Browser POSTs metadata: `POST /api/assets {brand_id, draft_id, url, kind, slot_index, role, label, tags}`
4. Server validates with `ffprobe` (via `@ffprobe-installer/ffprobe`):
   - Reels: 9:16 vertical (±2% tolerance), ≤90s, ≤100MB, has audio track
   - Carousel images: per-slot dims match Meta spec, JPEG/PNG, ≤8MB each
5. Insert `assets` row + `draft_assets` join row
6. If draft now has all required slots filled → `drafts.status = 'awaiting_final_review'`

**Library upload (no draft):** same flow without `draft_id`, no `draft_assets` insert.

**Pick from library:** browser sends existing asset id → only `draft_assets` insert.

### Pipeline 5a: Publish (cron sweep)

**Trigger:** Vercel Cron every 5 minutes.

**Steps:**
1. `SELECT * FROM posts WHERE status='queued' AND scheduled_for <= NOW() ORDER BY scheduled_for LIMIT N`
2. For each post:
   - Mark `status='publishing'`
   - Call channel-specific Publisher:
     - **IG Reel:** create media container with video URL → poll `status_code` until `FINISHED` → POST `/media_publish` → store `external_post_id`
     - **IG Carousel:** create child containers for each item → create carousel container with children → publish
     - **IG Image:** container with image URL → publish
     - **FB Post:** Graph API `/{page_id}/feed` or `/{page_id}/photos` or `/{page_id}/videos`
   - Success: `status='published'`, `external_post_id`, `external_url`, `published_at=NOW()`
   - Failure: `status='failed'`, `publish_error`, `publish_attempts++`. The `jobs-retry` cron (every 15 min) re-queues `posts` with `status='failed' AND publish_attempts < 3` using exponential backoff (1min, 5min, 30min from `last_error_at`). After 3 attempts, status stays `failed` permanently and surfaces in `system_alerts`.
3. Write `events` row per state transition

**Long-running IG Reel containers.** Video processing on Meta's side can exceed the 5-minute cron window for large videos. The publish handler does not block-poll — it creates the container, persists `external_container_id` on the `posts` row with status `publishing`, and returns. The next publish cron cycle re-checks containers in `publishing` state, polls Meta's `status_code`, and finalizes (`media_publish`) when `FINISHED`. Same "never block in cron" rule that applies to Apify.

**Token expiry:** Graph API 401 → mark `channel_connections.status='expired'` → banner on channel page → no publish attempts run while expired.

### Pipeline 5b: Analytics pull

**Trigger:** Vercel Cron schedule:
- Every hour for posts <7 days old (`analytics_hot`)
- Daily for posts 7-30 days old (`analytics_cold`)

**Steps:**
1. Select due posts
2. Call Meta Graph insights endpoint per `external_post_id`
3. Insert `analytics_snapshots` row (always new row — time series, never update)
4. Update `brand_metrics_snapshots` daily for follower count

### Pipeline 6: Pattern recompute (nightly)

**Trigger:** Vercel Cron 03:00 UTC daily.

**Steps:**
1. For each brand, query analytics_snapshots over last 30 days
2. Compute "what's working / what's not" callouts (hook patterns, format performance, ICP performance, posting time × day-of-week)
3. Cache as JSON on `brands.settings_json.patterns` (or dedicated table if it grows)

These callouts feed:
- Analytics page callouts cards
- Brief generation context next Monday

### State machines

**Brief:** `pending_review → {approved | edited → approved | rejected}`. Approval triggers draft generation.

**Draft:** `pending_review → {approved | edited → approved | rejected}`. Approval moves to `awaiting_assets`. All slots filled moves to `awaiting_final_review`. User clicks "Schedule" creates a `posts` row (status `queued`) and moves draft to terminal `scheduled`. The `queued` status lives **only on `posts`**, never on drafts.

**Post:** `queued → publishing → {published | failed (retry up to 3 with exponential backoff: 1min, 5min, 30min) → failed_terminal}`.

### Failure surfacing

A `system_alerts` view (computed from `jobs.status='failed'`, `channel_connections.status='expired'`, `posts.status='failed' AND publish_attempts>=3`) drives a badge on the sidebar. User can click to see all alerts and act.

---

## 7. Brand Onboarding Flow

8-step wizard, all skippable except Step 1, all resumable. Wizard is a UX wrapper around Settings tabs in the right order.

1. **Tell me about the brand** — choose: website URL, description, or both. Submit.
2. **Analyzing…** — progress view while Firecrawl + LLM run (~20-40s).
3. **Review brand profile** — pre-filled, all editable: basics (name, slug, one-line, audience), persona (archetype, traits, POV), voice tone sliders, voice language config, banned words, signature phrases, voice freeform description, example posts (user pastes 3-5).
4. **ICPs** — one drafted by LLM, edit/add/remove up to 3.
5. **Competitors & Inspiration** — two sections, optional, 0-10 each.
6. **Cadence** — preset picker (Sustainable/Growth★/Aggressive/Custom). Default: Growth = 5 Reels + 2 Carousels per week, no Stories.
7. **Connect channels** — Instagram + Facebook OAuth via Meta. Skip allowed.
8. **Done** — summary + "Run research now" button to skip the Sunday wait.

**Resumable:** brand created at Step 1 with `status='draft'`. Wizard reopens via "Continue setup" prompt on Home until a brand has a name + at least one ICP, then `status='active'`.

---

## 8. Settings Page Structure

Single page at `/settings` using shadcn `Tabs`:

| Tab | Contents |
|---|---|
| **App** | Theme (light/dark/system), LLM provider config (default + per-task overrides). API keys (Anthropic, Firecrawl, Apify, Meta App ID/secret, basic-auth password, Vercel Blob token) live in **env vars only** — Settings UI shows read-only configured/missing status (`✓ Configured` / `⚠ Missing`) but never reveals or edits values. Source of truth: Vercel env vars. |
| **Brand: Persona & Voice** | Same fields as onboarding Step 3 |
| **Brand: ICPs** | List + add/edit/delete (max 3) |
| **Brand: Competitors** | List + add/edit/delete |
| **Brand: Inspiration** | List + add/edit/delete |
| **Brand: Keywords** | List + add/pause/delete + manual "Pull now" per keyword |
| **Brand: Cadence** | Per-channel/format frequency sliders |
| **Brand: Channels** | OAuth connect/disconnect/reconnect for IG, FB; greyed for unbuilt channels |
| **Brand: Integrations** | Reserved for Drive/Dropbox sync (deferred); shows "Coming soon" |

Brand tabs operate on the active brand from sidebar switcher.

---

## 9. Analytics Page

**Single page** at `/analytics` with filters: channel, format, ICP, date range. URL-bound for bookmarkability.

**Layout (top → bottom):**
1. Filter bar + last-synced timestamp + manual refresh button
2. Six top-line cards: total reach, engagement rate, follower delta (period), posts published, avg reach/post, top format. Deltas vs prior equal period.
3. Three trend charts: reach over time (stacked by channel when "All"), engagement rate over time (line + brand-average overlay), follower growth (cumulative line).
4. Two callout cards: "What's working" + "Patterns to avoid" (computed nightly via Pipeline 6).
5. Sortable post table with thumb, channel, format, title, published date, reach, ER, saves, follower Δ. Click row → drill-down.

**Post drill-down** at `/analytics/post/[id]`:
- Hero: preview + caption + ICP target + external URL
- Performance metrics block (all available metrics)
- Watch retention chart (Reels)
- Live comments feed (pulled from Meta)
- **Provenance trail** — brief title + approval timestamp, inspiration sources, draft generation/edits/approval, asset uploads, schedule decision, publish event. Links to view full brief and draft.

The provenance trail is the key differentiator: over time, you see *exactly* which briefs/inspirations produce winners; that pattern feeds future generations.

---

## 10. Calendar Page

**Default month view:** grid with one tile per scheduled/published post. Tile shows status icon (`●` published, `◐` scheduled, `○` draft), format badge, time, channel color band.

**Week view:** hour grid, drag-and-drop to reschedule (updates `posts.scheduled_for`).

**Schedule UX:** when draft hits `awaiting_final_review`, default `scheduled_for` = next open slot in the cadence. User clicks "Schedule" → calendar opens at that slot pre-selected → confirm or pick different slot.

**Optimal-time hints:** v1 shows faint "★ best" star on slots matching top-performing day-of-week × hour for the brand × format from analytics_snapshots; falls back to category defaults until enough data. v1.5: auto-pick.

---

## 11. Cron Schedule (vercel.json)

**Requires Vercel Pro plan.** Hobby limits crons to once/day; the 5-minute, hourly, and weekday schedules below need Pro.

```
*/5 * * * *      → /api/cron/publish        — publish queued posts due now
0 * * * *        → /api/cron/analytics-hot  — hourly pull for posts <7d old
0 6 * * *        → /api/cron/analytics-cold — daily pull for posts 7-30d old
0 18 * * 0       → /api/cron/research       — Sunday 18:00 weekly research
0 7 * * 1        → /api/cron/briefs         — Monday 07:00 weekly brief batch
0 3 * * *        → /api/cron/patterns       — nightly pattern recompute
*/15 * * * *     → /api/cron/jobs-retry     — retry failed jobs
```

Each cron handler:
1. Reads from `jobs` table or runs scheduled work directly
2. Handles one batch synchronously (Vercel cron timeout: 5min Hobby / 15min Pro)
3. Writes `events` rows for state transitions
4. Updates job status

Long-running scrapes (Apify): cron *enqueues* an Apify run, polls completion in next cycle. Never block in cron.

---

## 12. Out of Scope (v1)

- **Authentication** beyond HTTP Basic Auth
- **Multiple users / SaaS tenancy** — schema has no `account_id`; refactor required if added later
- **Stories** (Reels + Carousels + Single image only for IG)
- **ICP engagement bot** (commenting/DMing target accounts) — the riskiest TOS surface; add only after publish loop is verified for ≥30 days
- **Blog, Newsletter, LinkedIn, TikTok, Pinterest publishing** — schema-stubbed, sidebar greyed
- **Image generation** (we generate prompts, not images; user uploads or generates externally)
- **Burned-in text overlays / video stitching** — user does post-production externally and uploads finished MP4
- **Google Drive / Dropbox bidirectional sync** — schema reserves columns; build deferred
- **Direct competitor analytics dashboard** — competitor data is an *input* to generation, not a UI surface
- **Conversion attribution** (UTM, Pixel, Conversions API) — Layer 4 analytics deferred

---

## 13. Open questions / decisions deferred

- Optimal-time auto-pick (v1.5): once enough data accumulated, auto-set `scheduled_for` to optimal slot. Behind setting flag.
- Per-task LLM override granularity: settings exposes default + per-task. Whether to also expose per-brand × per-task is deferred.
- `system_alerts` as a view vs. materialized table: start with view, promote if performance demands.

---

## 14. Migration / build order

1. **Bootstrap** — Next.js scaffold from template (auth files dropped), Drizzle setup with Neon, basic-auth middleware, Vercel Blob client, env vars
2. **Schema** — write all Drizzle schemas + initial migration; seed one test brand
3. **Brand workspace shell** — sidebar switcher, layout, theme, settings page tabs (read-only first, then editable)
4. **Onboarding wizard** — Steps 1-3 first (the persona extraction is the highest-value piece)
5. **Steps 4-6 of onboarding** — ICPs, competitors, inspiration, cadence
6. **LLM adapter + brief generation** — implement `LLMProvider` Anthropic adapter, build prompts, wire Brief generation pipeline (manual trigger first, cron after)
7. **Draft generation** — same pattern, channel-specific generators for IG (Reel/Carousel/Image)
8. **Asset library + upload** — Vercel Blob signed URLs, ffprobe validation, library + draft attachment
9. **Meta OAuth + Publisher** — Step 7 of onboarding, IG/FB connection, publish pipeline
10. **Calendar + scheduling** — month/week views, drag/drop, schedule action
11. **Analytics pull + page** — Graph insights, time-series storage, dashboard, drill-down
12. **Pattern recompute + callouts** — nightly job, surface in analytics + brief generation context
13. **Cron wiring + jobs table + alerts** — all schedulers + retry + system_alerts surface
14. **Research pipeline** — Apify + Firecrawl integration, weekly cron, manual refresh
15. **Polish** — error states, empty states, loading, accessibility pass

Each step is an independent unit that ships value end-to-end where possible.

---

## 15. Glossary

- **Brand** — an isolated persona/workspace within the app. One user, many brands.
- **ICP** — ideal customer profile; lean 5-field schema (name, description, pain points, where they hang out, content they engage with).
- **Voice** — hybrid schema: structured fields (tone sliders, emoji/hashtag policy, banned words, etc.) + freeform description + 3-5 example posts as few-shot.
- **Brief** — the contract for what a post will be (hook, angle, key message, format, target ICP, target date). Generated weekly. Approved → triggers draft.
- **Draft** — the deliverable copy + script + image prompts for a brief. Awaits approval, then assets, then schedule.
- **Asset** — a file (video/image/audio/graphic) in the brand's library. Attached to drafts via `draft_assets`. Reusable.
- **Post** — a unit of publication. Created when a draft is scheduled. Has a real external_post_id once published.
- **Analytics snapshot** — a time-series row of metrics for one post at one point in time. Many per post over its lifetime.
- **Provenance trail** — the linked chain (research → brief → draft → assets → schedule → publish → analytics) visible on any post.
