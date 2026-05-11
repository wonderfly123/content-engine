# Content Engine

A single-user, multi-brand content pipeline that automates **research → brief → draft → asset → schedule → publish → analytics** for Instagram and Facebook, with a roadmap for additional channels behind a shared backbone.

The differentiator isn't "post things" — it's the **research → brief → draft pipeline that learns from your rejections and your top-performing posts**, so briefs improve over time and winning patterns surface automatically.

Switch brands in the sidebar to change the active workspace (Wonderfly, personal woodworking, additional companies — one app, many personas).

See [`docs/superpowers/specs/2026-05-08-content-engine-foundation-design.md`](docs/superpowers/specs/2026-05-08-content-engine-foundation-design.md) for the full design.

---

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router), React 19, Tailwind v4, shadcn/ui |
| State | Zustand (UI), TanStack Query (server) |
| DB | Neon Postgres + Drizzle ORM, AES-256-GCM encrypted token columns |
| Storage | Vercel Blob (direct browser uploads via signed URLs) |
| LLM | Anthropic Claude — Sonnet 4.6 default, Opus 4.7 for nuanced voice work |
| Scraping | Firecrawl (web), Apify (Instagram competitor posts) |
| Publishing | Meta Graph API (IG Business/Creator + FB Pages) |
| Charts | recharts via shadcn Chart |
| Hosting | Vercel (Pro plan required — sub-daily cron schedules) |
| Auth | HTTP Basic Auth at edge middleware (single-user app) |

Every external integration is behind an adapter interface (`LLMProvider`, `Publisher`, `Researcher`, `CompetitorScraper`) — service-layer code never imports SDKs directly.

---

## Quick start

```bash
cp .env.example .env.local        # fill in values (see "Environment" below)
npm install
npm run db:push                   # create tables in your Neon DB
npm run db:seed                   # seed one Wonderfly test brand
npm run dev                       # http://localhost:3000 (basic-auth gated)
```

Open `http://localhost:3000`, authenticate with `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`, and you'll land on the Wonderfly dashboard. To go through the full onboarding wizard, click **+ Add Brand** in the sidebar.

---

## Environment

All secrets live in env vars only — never in code or the database. The Settings → App tab shows read-only `✓ Configured` / `⚠ Missing` status for each.

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex; encrypts OAuth tokens at rest (`scripts/db-encryption-keygen.ts` generates one) |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | Edge middleware auth |
| `CRON_SECRET` | Bearer token for `/api/cron/*` |
| `ANTHROPIC_API_KEY` | Claude (briefs, drafts, persona extraction) |
| `FIRECRAWL_API_KEY` | Site scraping + SERP search |
| `APIFY_TOKEN` | Instagram competitor/inspiration post scraping |
| `META_APP_ID` / `META_APP_SECRET` / `META_REDIRECT_URI` | IG + FB OAuth and Graph API |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (asset uploads) |

---

## Architecture

```
                  ┌──────────────────────────────────────────┐
                  │           Next.js (Vercel)                │
   Browser ─────► │  Pages (RSC)  API Routes  Server Actions  │
   (Basic Auth)   │              ┌─────┴─────┐                │
                  │              │  Services │                │
                  │      ┌───────┼─────┬─────┼────────┐       │
                  │   ┌──▼──┐ ┌──▼──┐ ┌▼───┐ ┌▼─────┐         │
                  │   │ LLM │ │ Pub │ │Rsch│ │Scrape│         │
                  │   └──┬──┘ └──┬──┘ └─┬──┘ └──┬───┘         │
                  │   Anthropic Meta Firecrawl Apify          │
                  │                                            │
                  │  Drizzle → Neon · Cron → jobs · Blob ◄ UI │
                  └────────────────────────────────────────────┘
```

**Pipelines** (`lib/pipelines/`):
1. **Research** (Sunday 18:00 UTC, weekly per brand) — competitors, keyword SERPs, trending hashtags, LLM pattern summary
2. **Briefs** (Monday 07:00 UTC) — N briefs per brand, where N = sum of `cadence_settings.per_week`. Context: persona + voice + ICP + research + recent rejections
3. **Drafts** (event-driven when a brief is approved) — channel-specific deliverable (Reel script, Carousel slides, Image, FB Post)
4. **Assets** — Vercel Blob signed upload → `ffprobe` validates Reel 9:16/≤90s/has-audio, carousel images per-slot dims → `draft_assets` join
5. **Publish** (every 5 min) — IG Reel container → poll status across cron cycles → `media_publish`; FB feed/photos/videos. Retries 1m/5m/30m × 3
6. **Analytics** — hot pull hourly for posts <7d, cold pull daily for posts 7–30d. Time series, never updated
7. **Patterns** (nightly) — aggregate analytics into `brands.settings_json.patterns`; feeds Analytics callouts + next week's brief context

**State machines** (Section 6):
- Brief: `pending_review → {approved | edited → approved | rejected}`
- Draft: `pending_review → approved → awaiting_assets → awaiting_final_review → scheduled`
- Post: `queued → publishing → {published | failed → ... → failed_terminal}`

Every transition writes an `events` row.

---

## Page layout

```
[Brand Switcher ▼]      ← top of sidebar
🏠 Home                 ← cross-brand totals
─────
📊 Dashboard            ← today's queue, week preview, alerts
🔬 Research             ← latest bundle + manual refresh
📝 Briefs               ← approve/edit/reject queue
✏️  Drafts              ← copy + script awaiting approval
📦 Assets               ← Library + Pending tabs
📅 Calendar             ← month/week views, drag-to-reschedule
📈 Analytics            ← unified live view, post drill-down
─── Channels ───
📷 Instagram / 👥 Facebook
✍️  Blog / 📧 Newsletter / 💼 LinkedIn / 🎵 TikTok / 📌 Pinterest   (greyed)
─────
⚙️  Settings (9 tabs)
➕ Add Brand
```

Workflow-first pages (Briefs, Drafts, Assets, Calendar) show all channels filtered by stage. Channel-first pages (Instagram, Facebook) show all stages filtered by channel.

---

## Cron schedule (`vercel.json`)

```
*/5 * * * *   /api/cron/publish        — publish queued posts
0 * * * *     /api/cron/analytics-hot  — hourly pull for posts <7d
0 6 * * *     /api/cron/analytics-cold — daily pull for posts 7–30d
0 18 * * 0    /api/cron/research       — Sunday weekly research
0 7 * * 1     /api/cron/briefs         — Monday weekly brief batch
0 3 * * *     /api/cron/patterns       — nightly pattern recompute
*/15 * * * *  /api/cron/jobs-retry     — retry failed jobs
```

All cron routes auth via `Authorization: Bearer ${CRON_SECRET}`.

---

## Scripts

```bash
npm run dev          # Next.js dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint-config-next
npm test             # vitest (150 tests across 21 files)

npm run db:generate  # generate a migration from schema diff
npm run db:push      # apply schema directly (dev)
npm run db:migrate   # apply migrations (prod)
npm run db:seed      # seed Wonderfly test brand
npm run db:studio    # Drizzle Studio (browse data)
```

---

## Out of scope (v1)

- Multi-user / SaaS tenancy (schema has no `account_id`)
- Stories (Reels + Carousels + Single images only on IG)
- ICP engagement bot (the riskiest TOS surface — defer until publish loop is proven for 30 days)
- Blog, Newsletter, LinkedIn, TikTok, Pinterest publishing (schema-stubbed, sidebar greyed)
- Image generation (we generate prompts, not images — user uploads finished MP4/JPG)
- Burned-in text overlays / video stitching (user does post-production externally)
- Google Drive / Dropbox bidirectional sync (schema reserves columns)
- Conversion attribution (UTM, Pixel, CAPI)

---

## Known follow-ups

1. Extend `LLMProvider` with `summarizePatterns` and `Publisher` with `pollContainer` / `publishContainer` — pipelines currently use local helpers as workarounds
2. Real Meta Graph wiring — `Publisher.publish` / `fetchAnalytics` / `refreshToken` still throw `not_implemented`
3. Video thumbnails — Vercel has no ffmpeg; needs an external worker or transcode service
4. Voice schema mismatch — onboarding has 6 tone sliders, `lib/db/types.ts` types only 4; onboarding translates at save
5. Inspiration + Competitors share one settings tab (spec lists them separately)
6. Brand context flows via `?brandId=` query param; topbar-injected param would be cleaner

---

## Glossary

- **Brand** — isolated persona/workspace. One user, many brands.
- **ICP** — ideal customer profile. Lean 5-field schema.
- **Voice** — hybrid: structured fields (tone sliders, emoji/hashtag policy, banned words) + freeform description + 3–5 example posts as few-shot.
- **Brief** — contract for what a post will be (hook, angle, key message, format, target ICP, target date). Generated weekly. Approved → triggers draft.
- **Draft** — deliverable copy + script + image prompts. Awaits approval, then assets, then schedule.
- **Asset** — file in the brand's library. Attached to drafts via `draft_assets`. Reusable.
- **Post** — unit of publication. Created when a draft is scheduled.
- **Provenance trail** — the chain (research → brief → draft → assets → schedule → publish → analytics) visible on any post. Over time, you see exactly which briefs/inspirations produce winners; that pattern feeds future generations.
