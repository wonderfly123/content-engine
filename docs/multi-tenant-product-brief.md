# Brief: open Content Engine to other people

Written 2026-11-14 for a Claude Code session working in this folder.

## The goal

Turn this app into a product other people can sign up for and use, each with their own separated account. It is the same app, not a new product, and it keeps its name.

What separates one person's content machine from another's is their data and their AI skill and prompting. Everything else (review, editing, scheduling, publishing, analytics) is shared machinery.

## Decisions already made

- **One app.** A separate project was started at `~/gym-reels` and abandoned. That folder is reference material only (see "Reference material").
- **Same database.** Use this app's existing Supabase project with logical separation. Do not create a second database.
- **Sign-up now.** People must be able to create their own account without waiting for approval.
- **Runs in the cloud.** The whole app, including video storage and rendering, must work for a user who has nothing but a browser. Nothing may depend on Jordan's machine.
- **Onboarding connects everything.** After sign-up, a brand onboarding flow walks the user through every outside system the app needs, by signing in to it (OAuth) where that exists or by pasting in a key where it doesn't. Each workspace runs on its own connections and keys.
- **Dashboard first.** A user must be able to do everything from the dashboard, including uploading clips in the browser.
- **Texting is a later add-on.** Texting back and forth with Claude to request and approve edits is not part of this work. Don't build it, and don't design anything that blocks it.
- **Jordan's local workflow keeps working.** He uploads and renders on his own machine today and that path must not break.

## How the app works today

Checked on 2026-11-14 by reading the code and querying the database read-only. Verify anything you build on.

**Data model**
- Everything hangs off `brands` (`lib/db/schema.ts`). Most tables carry a required `brand_id`.
- Exceptions: `jobs.brand_id` is nullable, and `events` has no brand column at all.
- `brands.slug` is unique across the whole database.
- A comment in the ads section of the schema says the design assumes a single user.
- There is no table linking a signed-in user to a brand. Nothing records who owns what.

**Access**
- `lib/auth/access.ts`: role (`admin` or `user`) and status (`pending`, `active`, `disabled`) live in each user's Supabase `app_metadata` under `ce_role` and `ce_status`.
- `app/auth/callback/route.ts`: the first account to sign in becomes the active admin. Everyone after that is `pending` until approved in Admin.
- `middleware.ts` applies `decideAccess` to every request. It decides whether you may use the app, not which brand you may see.
- API routes take `brandId` from the request and filter by it (for example `app/api/assets/route.ts`). A search for `getAccess` found it used only in `lib/auth/session.ts`, `lib/publishing/meta.ts`, `lib/publishing/meta-graph.ts` and `app/pending/page.tsx`, so the routes appear not to check that the caller owns the brand they ask for. Confirm this route by route; it is the heart of the separation work.
- The active brand is chosen in the browser (`lib/stores/brand-store.ts`, `components/layout/brand-switcher.tsx`).

**Database**
- 21 tables in the `public` schema. Row-level security is switched on for all of them, with no policies found, so the browser cannot read them and all access goes through the server's direct connection.
- One auth user, signed in with Google.
- No Drizzle migrations table exists, although `drizzle/0000_tired_omega_flight.sql` does. Find out how schema changes have been applied so far before choosing how to apply new ones.

**Video**
- The reel pipeline is local-first (`lib/reels/store.ts`). The video skill writes a manifest per job at `<jobs>/<job>/_cuts/review.json`; the folder defaults to `~/Desktop/ai-video-editing/jobs` (`VIDEO_JOBS_DIR`).
- Each manifest names its brand by slug.
- Preview re-rendering runs ffmpeg on the machine the app runs on (`lib/reels/render.ts`).
- The video skill itself lives outside this repo, at `~/.claude/skills/cutting-montage-videos`.
- The review and editing screens (`components/reels/*`: clip editor, trim, voice recorder, final review) already exist and work against those local files.

**Uploads and storage**
- Assets upload from the browser to Vercel Blob (`app/api/assets/upload-url/route.ts`), capped at 100 MB per file, into a public store.
- The upload handshake trusts the `brandId` the browser sends.

**Outside services**
- Keys are read from environment variables, one set for the whole app: Anthropic, the Meta app, Vercel Blob. (Update: Anthropic is now a per-workspace key.)
- Instagram and Facebook are the exception: each brand connects its own account and the token is stored encrypted in `channel_connections` (`lib/db/crypto.ts`).
- Research (no outside research service is used any more) has cron routes at `app/api/cron/research`, `briefs` and `patterns`, but `vercel.json` does not schedule them. Only `publish`, `jobs-retry`, `connections`, `analytics-hot` and `analytics-cold` run on a schedule. Whether research has been run by hand was not checked.
- Nothing exists yet for cloud video storage or cloud rendering. Cloudflare R2 and Modal were proposed in the earlier plan and never built; `~/gym-reels` has only empty placeholders for their keys.

**AI**
- `lib/llm/prompts.ts` builds prompts from the brand's persona, voice settings, free-form voice notes and voice examples. Those are already per brand.
- The video editing behaviour is in the skill, not in the database, so it is the same for every brand.

## What to build

### 1. Logical separation

- Add an account layer above brands. "Workspace" is the working name.
- A workspace has members (a signed-in user, with a role such as owner or staff) and owns one or more brands.
- Jordan's existing brands and all their data move into his workspace.
- Every request that names a brand, or anything belonging to a brand, must be checked against the caller's workspace on the server. Aim for one shared check that every route and server action goes through, so a new route cannot forget it.
- Cover the awkward tables: `jobs` with no brand, `events` with no brand column, and the ads tables.
- Brand slugs should be unique per workspace, not globally. Check what depends on the global uniqueness first (the reel manifests name brands by slug).
- Cron routes (`app/api/cron/*`) run for every brand. Make sure one workspace's failure or expired connection cannot stall the others.
- Files: one workspace must not be able to fetch another's media. The current Blob store is public; see item 3.
- Proof: an automated test that creates two workspaces and tries every table, route and file link as one against the other. It must fail everywhere, and it must run with the rest of the tests.

### 2. Sign-up

- Sign in with Google (exists) and with email and password (new). Both are enabled in the Supabase dashboard; add the email and password form to `app/login`.
- A new person signing up gets a workspace created for them, becomes its owner, and lands in the existing onboarding (`app/onboarding`).
- Remove the wait-for-approval step for normal sign-ups. Keep the ability to disable an account.
- Jordan stays the platform admin: he can see every workspace in Admin. Nobody else can see outside their own.
- Inviting a second person into a workspace is wanted eventually; design for it, build it only if it is cheap.
- Other people's Instagram accounts can only connect once the Meta app has passed review; until then only accounts added as testers work. Note where that stands.

### 2b. Onboarding that connects everything

- Extend the existing brand onboarding (`app/onboarding`, `components/onboarding/*`) with a connections step that covers every outside system the app uses.
- For each system, use sign-in (OAuth) where the provider offers it and a pasted key where it doesn't. Instagram and Facebook already work by sign-in. Anthropic is a key. Anthropic does not allow third-party apps to offer "sign in with Claude", so that one is a pasted API key.
- Store every credential per workspace, encrypted the way `channel_connections` tokens are, decrypted only on the server at the moment of use. Never send a stored key back to the browser; show only that it is set, with a way to replace or remove it.
- Test each credential when it is entered and show a clear pass or fail. Reuse the connection health check (`lib/connections/check.ts`, `app/api/cron/connections`) so a key that stops working raises an alert.
- Every place that reads a key from an environment variable today must read the workspace's own instead. List those places.
- Features whose connection is missing should be visibly switched off with a link to connect, not fail.
- Jordan's current environment keys become his workspace's stored credentials.
- Decide which systems each workspace supplies and which the platform supplies. The likely split: workspaces bring their own social accounts and their own AI and research keys; the platform provides shared infrastructure the user should never think about (database, video storage, rendering). Recommend a split and say what it means for cost: anything the platform supplies is paid for by Jordan and needs a per-workspace limit before sign-up opens to strangers.

### 3. Everything from the dashboard, including uploading

- A user uploads raw clips in the browser and gets an edited video back for review, with no access to Jordan's machine.
- Today both the footage and the rendering are local, and no cloud version of either has been built. This is new work, not something to copy over. Say what has to move to the cloud and recommend how. The earlier plan proposed Cloudflare R2 for private storage with short-lived signed links and resumable uploads for large phone footage, and a Modal worker running ffmpeg and the video skill.
- The video skill currently runs as Claude Code on Jordan's machine. In the cloud it needs to run without him: either the same skill run headless inside the worker, or a fixed pipeline where code runs the steps and Claude only returns the cut list and caption. The earlier plan suggested starting with the first and moving to the second (`~/gym-reels/docs/plan.md`, "Modal render worker").
- The 100 MB upload cap is too small for 4K phone clips.
- Keep the review and editing screens. They should work the same whether the job's files are local (Jordan) or in cloud storage (everyone else). Propose the cleanest way to put one interface over both.
- Storage costs money per workspace. The earlier plan sized it and recommended an included amount with a visible meter and paid add-on packs (`~/gym-reels/docs/plan.md`, "Storage"). Don't build billing now, but record usage per workspace so it can be capped later.

### 4. A per-workspace AI skill

- Each workspace has its own editing and writing instructions that the AI follows.
- The owner can read them, edit them, and teach them in plain words ("always open on a lift", "never use this song", "shorter captions").
- Writing voice is already per brand. The gap is the video editing behaviour, which lives in one shared skill on Jordan's machine.
- Propose how the skill becomes a shared base plus per-workspace instructions stored in the database, with Jordan's current behaviour as the starting point for his workspace and a sensible default for new ones.
- Corrections a user makes while reviewing (trims, rejected cuts, notes back to the editor) are a natural source of teaching. Say whether and how they should feed the instructions.

## Later: texting add-on

Not part of this work. When it comes, working pieces exist to lift:

- `~/gym-reels/src/lib/sms/` — Twilio signature check, phone normalising, the text router, the handler
- `~/gym-reels/src/app/api/twilio/sms/route.ts` — the incoming-text webhook
- `~/gym-reels/tests/` — tests for the above, including Twilio's documented signature example
- `~/gym-reels/docs/plan.md`, "The text conversation" and "AI editor chat" — the intended flow: one shared number, the sender's phone identifies the account, and texts and in-app chat share one thread per video

## Reference material

`~/gym-reels/docs/plan.md` is the earlier plan. Ignore its name and its "separate product" framing. Sections worth reading:

- "Multi-tenant separation" — six layers of separation, including the two-account test
- "Light editor" — splits, voiceover on or off, intro hook text, caption, all on one screen
- "Caps and pricing" and "Storage" — limits, storage sizing and add-on packs
- "Running cost" — rough per-video costs

`~/gym-reels/src` is a small skeleton on the same stack. Apart from the texting pieces above, nothing in it needs to come over.

## Rules

- **Uncommitted work.** This folder has uncommitted changes in progress (reel voiceover and review work). Do not commit, stash or overwrite them. Work around them and say so if something conflicts.
- **The database is live.** It holds Jordan's real data. Show every database change before running it. Moving existing rows into a workspace needs a backup first and a way back.
- **No secrets in code or commits.**
- **Keep the look and navigation.** A new user should see the same app Jordan sees, with only their own workspace in it.
- **Tests.** Run the existing tests after changes and add tests for the separation rules.

## First step

Do not write code yet. Read the codebase, then reply with:

1. A short plan for the items under "What to build", in the order you would build them.
2. Anything in "How the app works today" that turned out to be wrong.
3. Your recommendation on each open decision below.

## Open decisions

1. **Where the workspace link lives.** Only on `brands` (everything else reaches it through its brand), or copied onto every table. The first is less change; the second makes database-level rules simpler.
2. **Where separation is enforced.** In one server-side access layer with the database locked to the browser as it is now, or with database policies as well.
3. **How Jordan's data moves.** The steps, the backup, and how to undo it.
4. **Two kinds of user.** How the platform admin and self-serve workspace owners coexist in `lib/auth/access.ts`.
5. **Who supplies what.** Which keys and accounts each workspace brings and which the platform provides, and the limit on anything the platform pays for.
6. **Cloud storage and rendering.** Which services, and how the local and cloud paths share one interface.
7. **The skill.** How the shared base and per-workspace instructions are stored and combined.
