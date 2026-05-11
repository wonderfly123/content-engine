# Content Engine — Phase 1: Foundation Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable Next.js 16 app with Neon-backed Drizzle schema, HTTP basic auth at the edge, brand switcher, theme system, and read-only Settings tabs surfacing seeded brand data. End state: you can boot the app, log in via basic auth, switch between two seeded brands, navigate every workspace page (placeholders for unbuilt features), and see brand-scoped data in Settings tabs.

**Architecture:** Fork the dashboard-reusable-template, strip its Supabase auth surface, replace with Neon + Drizzle. All non-auth template components (layout, theme, shadcn/ui primitives, Tailwind v4 config) carry over verbatim. Brand-scoped pages live under `app/(brand)/[brandSlug]/...` with the active brand resolved from the URL and mirrored into a Zustand store for client components.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (Radix) · Zustand · TanStack Query · Drizzle ORM · @neondatabase/serverless · Vitest · Vercel Cron (declared but not used yet)

**Spec:** `docs/superpowers/specs/2026-05-08-content-engine-foundation-design.md`

---

## File Map

Files created or modified in this phase, grouped by responsibility:

### Project root
- Create: `package.json`, `tsconfig.json`, `postcss.config.mjs`, `next.config.ts`, `components.json`, `eslint.config.mjs`, `next-env.d.ts`
- Create: `drizzle.config.ts` — Drizzle Kit configuration
- Create: `vercel.json` — placeholder for cron schedule (no jobs yet)
- Create: `vitest.config.ts` — test runner config
- Create: `.env.local.example`, `.gitignore`
- Create: `middleware.ts` — basic auth gate

### App
- Create: `app/layout.tsx` — root HTML, fonts, providers
- Create: `app/page.tsx` — redirects to active brand's dashboard or `/home`
- Create: `app/globals.css` — verbatim from template (OKLCH theme)
- Create: `app/providers.tsx` — Theme + Query providers (no auth)
- Create: `app/home/page.tsx` — cross-brand placeholder
- Create: `app/(brand)/layout.tsx` — brand workspace layout, resolves active brand from URL
- Create: `app/(brand)/[brandSlug]/dashboard/page.tsx`
- Create: `app/(brand)/[brandSlug]/research/page.tsx`
- Create: `app/(brand)/[brandSlug]/briefs/page.tsx`
- Create: `app/(brand)/[brandSlug]/drafts/page.tsx`
- Create: `app/(brand)/[brandSlug]/assets/page.tsx`
- Create: `app/(brand)/[brandSlug]/calendar/page.tsx`
- Create: `app/(brand)/[brandSlug]/analytics/page.tsx`
- Create: `app/(brand)/[brandSlug]/instagram/page.tsx`
- Create: `app/(brand)/[brandSlug]/facebook/page.tsx`
- Create: `app/(brand)/[brandSlug]/settings/page.tsx` — tabbed view, read-only

### Components
- Create: `components/layout/app-layout.tsx`, `app-header.tsx`, `page-container.tsx`, `sidebar.tsx` — adapted from template
- Create: `components/layout/brand-switcher.tsx` — Combobox dropdown of brands
- Create: `components/ui/button.tsx`, `card.tsx`, `badge.tsx`, `tabs.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `tooltip.tsx` — verbatim from template
- Create: `components/empty-state.tsx` — reused on placeholder pages

### Library
- Create: `lib/db/schema.ts` — all Drizzle table definitions
- Create: `lib/db/client.ts` — Neon HTTP client + Drizzle factory
- Create: `lib/db/encryption.ts` — AES-256-GCM column transformer for token columns
- Create: `lib/db/seed.ts` — seed two test brands
- Create: `lib/brands/queries.ts` — `listBrands`, `getBrandBySlug`
- Create: `lib/stores/sidebar-store.ts` — verbatim from template
- Create: `lib/stores/active-brand-store.ts` — active brand id/slug
- Create: `lib/theme/theme-context.tsx` — verbatim from template
- Create: `lib/utils.ts` — verbatim from template (cn helper)
- Create: `lib/env.ts` — typed env access

### Tests
- Create: `tests/setup.ts`, `tests/db-test-utils.ts`
- Create: `tests/middleware.test.ts`
- Create: `tests/db/encryption.test.ts`
- Create: `tests/db/schema-roundtrip.test.ts`
- Create: `tests/brands/queries.test.ts`
- Create: `tests/stores/active-brand-store.test.ts`

### Drizzle migrations
- Generated: `drizzle/migrations/0000_*.sql` (committed)

---

## Conventions

- **TDD where it adds value** (auth, encryption, queries, store logic). Verbatim template files (CSS, shadcn/ui primitives) ship without a failing-test step.
- **Commit cadence:** at the end of every numbered Task. Each commit message: `feat(phase-1): <task name>` (or `chore`, `test`, etc.).
- **Test runner:** Vitest. Database tests run against a local Neon branch (free tier supports DB branching) via `DATABASE_URL_TEST`. Tests skip cleanly if `DATABASE_URL_TEST` is unset, so CI without DB still passes the non-DB suite.
- **Drizzle:** schemas in `lib/db/schema.ts`, migrations generated via `npm run db:generate`, applied via `npm run db:push` (Phase 1 only — switch to migrate flow Phase 2+).
- **Branding placeholder:** sidebar uses a generic "Content Engine" wordmark; replace with logo files later.

---

## Task 1: Initialize Next.js project + base configuration

**Files:**
- Create: `package.json`, `tsconfig.json`, `postcss.config.mjs`, `next.config.ts`, `eslint.config.mjs`, `components.json`, `next-env.d.ts`, `.gitignore`, `.env.local.example`

- [ ] **Step 1: Init project directory**

```bash
cd /Users/jordan/content_engine
git init
```

- [ ] **Step 2: Create `package.json`**

Copy from template's `### package.json` block, then:
- Remove `@supabase/supabase-js`
- Add `@neondatabase/serverless` `^0.10.0`, `drizzle-orm` `^0.36.0`, `drizzle-kit` `^0.28.0` (devDep)
- Add `@anthropic-ai/sdk` `^0.32.0` (used Phase 3+ but install now)
- Add `@vercel/blob` `^0.27.0` (used Phase 4+)
- Add `vitest` `^2.1.0`, `@vitest/ui`, `@testing-library/react` `^16.0.0`, `jsdom` `^25.0.0` (devDeps)

Final `dependencies`:
```json
{
  "@anthropic-ai/sdk": "^0.32.0",
  "@neondatabase/serverless": "^0.10.0",
  "@radix-ui/react-dialog": "^1.1.15",
  "@radix-ui/react-dropdown-menu": "^2.1.16",
  "@radix-ui/react-slot": "^1.2.4",
  "@radix-ui/react-tabs": "^1.1.13",
  "@radix-ui/react-tooltip": "^1.2.8",
  "@tanstack/react-query": "^5.90.12",
  "@vercel/blob": "^0.27.0",
  "class-variance-authority": "^0.7.1",
  "clsx": "^2.1.1",
  "date-fns": "^4.1.0",
  "drizzle-orm": "^0.36.0",
  "lucide-react": "^0.562.0",
  "next": "16.1.0",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "tailwind-merge": "^3.4.0",
  "zustand": "^5.0.9"
}
```

`devDependencies`:
```json
{
  "@tailwindcss/postcss": "^4",
  "@testing-library/react": "^16.0.0",
  "@types/node": "^20",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "@vitest/ui": "^2.1.0",
  "drizzle-kit": "^0.28.0",
  "eslint": "^9",
  "eslint-config-next": "16.1.0",
  "jsdom": "^25.0.0",
  "tailwindcss": "^4",
  "tw-animate-css": "^1.4.0",
  "typescript": "^5",
  "vitest": "^2.1.0"
}
```

`scripts`:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "db:push": "drizzle-kit push",
  "db:seed": "tsx lib/db/seed.ts"
}
```

(Add `tsx` `^4.19.0` to devDependencies.)

- [ ] **Step 3: Copy unchanged template configs**

`tsconfig.json`, `postcss.config.mjs`, `next.config.ts`, `eslint.config.mjs`, `components.json` — copy verbatim from `reusable-dashboard-starter-template.md`.

- [ ] **Step 4: Create `.env.local.example`**

```
# Database
DATABASE_URL=postgres://USER:PASS@HOST/db?sslmode=require
DATABASE_URL_TEST=postgres://USER:PASS@HOST/db_test?sslmode=require

# Auth (basic auth at edge)
SITE_USERNAME=jordan
SITE_PASSWORD=change-me-locally

# Token encryption (32 hex bytes = 64 hex chars; generate via openssl rand -hex 32)
TOKEN_ENCRYPTION_KEY=

# LLM providers (Phase 3+)
ANTHROPIC_API_KEY=

# Storage (Phase 4+)
BLOB_READ_WRITE_TOKEN=

# Scraping (Phase 6)
FIRECRAWL_API_KEY=
APIFY_API_TOKEN=

# Meta (Phase 4)
META_APP_ID=
META_APP_SECRET=
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules
.next
.env.local
.env.*.local
*.log
.DS_Store
.trash
.vercel
drizzle/.cache
.vitest-cache
```

- [ ] **Step 6: Install + verify build**

Run: `npm install && npx next build`
Expected: build succeeds with "no pages found" or similar minimal output (no app files yet).

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore(phase-1): scaffold Next.js 16 + Tailwind + dependencies"
```

---

## Task 2: Copy template UI primitives

**Files:**
- Create: `lib/utils.ts`, `app/globals.css`
- Create: `components/ui/button.tsx`, `card.tsx`, `badge.tsx`, `tabs.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`

- [ ] **Step 1: Copy `lib/utils.ts`** verbatim from template (`### lib/utils.ts` block).
- [ ] **Step 2: Copy `app/globals.css`** verbatim from template.
- [ ] **Step 3: Copy each `components/ui/*.tsx`** verbatim from template's `## shadcn/ui Components` section.
- [ ] **Step 4: Verify build**

Run: `npx next build`
Expected: build succeeds (still no pages, but no type errors).

- [ ] **Step 5: Commit**

```bash
git add lib/utils.ts app/globals.css components/ui
git commit -m "chore(phase-1): import shadcn/ui primitives + globals.css from template"
```

---

## Task 3: Set up Vitest

**Files:**
- Create: `vitest.config.ts`, `tests/setup.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 2: Write `tests/setup.ts`**

```ts
import { afterAll, beforeAll } from "vitest";

beforeAll(() => {
  // shared setup placeholder
});

afterAll(() => {
  // shared teardown placeholder
});
```

- [ ] **Step 3: Add a smoke test**

Create `tests/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/
git commit -m "chore(phase-1): wire Vitest"
```

---

## Task 4: Basic auth middleware (TDD)

**Files:**
- Create: `tests/middleware.test.ts`, `middleware.ts`, `lib/env.ts`

- [ ] **Step 1: Write `lib/env.ts`**

```ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  SITE_USERNAME: optional("SITE_USERNAME") ?? "jordan",
  SITE_PASSWORD: () => required("SITE_PASSWORD"),
  DATABASE_URL: () => required("DATABASE_URL"),
  DATABASE_URL_TEST: optional("DATABASE_URL_TEST"),
  TOKEN_ENCRYPTION_KEY: () => required("TOKEN_ENCRYPTION_KEY"),
  ANTHROPIC_API_KEY: optional("ANTHROPIC_API_KEY"),
};
```

Functions returning a value are lazy so tests can construct mock envs after import.

- [ ] **Step 2: Write failing test `tests/middleware.test.ts`**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("https://example.com/", { headers });
}

describe("basic-auth middleware", () => {
  beforeEach(() => {
    process.env.SITE_USERNAME = "jordan";
    process.env.SITE_PASSWORD = "secret";
  });

  it("returns 401 with WWW-Authenticate when no header is present", async () => {
    const res = await middleware(makeRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="content-engine"');
  });

  it("returns 401 when credentials are wrong", async () => {
    const auth = "Basic " + Buffer.from("jordan:wrong").toString("base64");
    const res = await middleware(makeRequest({ authorization: auth }));
    expect(res.status).toBe(401);
  });

  it("passes through when credentials match", async () => {
    const auth = "Basic " + Buffer.from("jordan:secret").toString("base64");
    const res = await middleware(makeRequest({ authorization: auth }));
    expect(res.status).toBe(200);
  });

  it("uses constant-time compare (no early-return on prefix match)", async () => {
    // Smoke check — if the implementation uses === then this still passes.
    // Real verification is code review, but we keep this test as documentation.
    const auth = "Basic " + Buffer.from("jordan:s").toString("base64");
    const res = await middleware(makeRequest({ authorization: auth }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run test (should fail — middleware doesn't exist)**

Run: `npm test -- middleware`
Expected: FAIL — `Cannot find module '../middleware'`

- [ ] **Step 4: Write `middleware.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

const REALM = 'Basic realm="content-engine"';

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function middleware(req: NextRequest) {
  const expectedUser = process.env.SITE_USERNAME ?? "jordan";
  const expectedPass = process.env.SITE_PASSWORD;
  if (!expectedPass) {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": REALM },
    });
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx === -1) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": REALM },
    });
  }

  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);

  if (!safeEqual(user, expectedUser) || !safeEqual(pass, expectedPass)) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": REALM },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 5: Run test (should pass)**

Run: `npm test -- middleware`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add middleware.ts lib/env.ts tests/middleware.test.ts
git commit -m "feat(phase-1): basic auth middleware at edge"
```

---

## Task 5: Token encryption (TDD)

**Files:**
- Create: `tests/db/encryption.test.ts`, `lib/db/encryption.ts`

- [ ] **Step 1: Write failing test `tests/db/encryption.test.ts`**

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { encrypt, decrypt } from "../../lib/db/encryption";
import { randomBytes } from "node:crypto";

describe("token encryption", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  });

  it("roundtrips a string", () => {
    const plain = "ig_token_xyz_abc_123";
    const ct = encrypt(plain);
    expect(ct).not.toBe(plain);
    expect(decrypt(ct)).toBe(plain);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const plain = "same-text";
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });

  it("throws on tampered ciphertext", () => {
    const ct = encrypt("hello");
    const tampered = ct.slice(0, -2) + "ZZ";
    expect(() => decrypt(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test — should fail (no module)**

Run: `npm test -- encryption`
Expected: FAIL — module not found

- [ ] **Step 3: Write `lib/db/encryption.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  if (hex.length !== 64) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes hex (64 chars)");
  return Buffer.from(hex, "hex");
}

const ALG = "aes-256-gcm";

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Invalid ciphertext");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- encryption`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add lib/db/encryption.ts tests/db/encryption.test.ts
git commit -m "feat(phase-1): AES-256-GCM token encryption helpers"
```

---

## Task 6: Drizzle config + Neon client

**Files:**
- Create: `drizzle.config.ts`, `lib/db/client.ts`

- [ ] **Step 1: Provision a Neon project**

Manual: create a Neon project, branch `main` for prod, branch `test` for tests. Copy both connection strings into `.env.local` as `DATABASE_URL` and `DATABASE_URL_TEST`. Skip if you don't have a Neon account yet — schema work below works without DB until Task 9.

- [ ] **Step 2: Write `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 3: Write `lib/db/client.ts`**

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __db__: ReturnType<typeof drizzle> | undefined;
}

function makeDb(connectionString: string) {
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}

export function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  if (!global.__db__) {
    global.__db__ = makeDb(process.env.DATABASE_URL);
  }
  return global.__db__;
}

export function getTestDb() {
  if (!process.env.DATABASE_URL_TEST) throw new Error("DATABASE_URL_TEST not set");
  return makeDb(process.env.DATABASE_URL_TEST);
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors. (Schema doesn't exist yet — `import * as schema from "./schema"` will fail. Add a placeholder if needed; Task 7 fills it.)

If TypeScript complains, create a stub `lib/db/schema.ts`:
```ts
export {};
```
We'll replace it in Task 7.

- [ ] **Step 5: Commit**

```bash
git add drizzle.config.ts lib/db/client.ts lib/db/schema.ts
git commit -m "chore(phase-1): wire Neon + Drizzle client"
```

---

## Task 7: Drizzle schema — core tables

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Replace `lib/db/schema.ts` — brand + brand-config tables**

```ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  boolean,
  integer,
  pgEnum,
  uniqueIndex,
  primaryKey,
  date,
} from "drizzle-orm/pg-core";

// Enums
export const channelEnum = pgEnum("channel", [
  "instagram",
  "facebook",
  "blog",
  "newsletter",
  "linkedin",
  "tiktok",
  "pinterest",
]);

export const formatEnum = pgEnum("format", [
  "reel",
  "carousel",
  "image",
  "story",
  "post",
  "article",
  "email",
  "pin",
]);

export const brandStatusEnum = pgEnum("brand_status", ["draft", "active", "archived"]);

// brands
export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: brandStatusEnum("status").notNull().default("draft"),
  websiteUrl: text("website_url"),
  description: text("description"),
  personaJson: jsonb("persona_json").$type<Record<string, unknown>>(),
  voiceJson: jsonb("voice_json").$type<Record<string, unknown>>(),
  voiceFreeform: text("voice_freeform"),
  voiceExamples: jsonb("voice_examples").$type<Array<{ text: string; note?: string }>>(),
  settingsJson: jsonb("settings_json").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// icps
export const icps = pgTable("icps", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  painPoints: text("pain_points").array(),
  whereTheyHangOut: text("where_they_hang_out"),
  contentTheyEngageWith: text("content_they_engage_with"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// competitors
export const competitors = pgTable("competitors", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  platform: text("platform").notNull(), // not enum — allow any platform string
  url: text("url"),
  notes: text("notes"),
  pullWindowDays: integer("pull_window_days").notNull().default(30),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// inspiration_accounts
export const inspirationAccounts = pgTable("inspiration_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  platform: text("platform").notNull(),
  url: text("url"),
  notes: text("notes"),
  pullWindowDays: integer("pull_window_days").notNull().default(30),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// keywords
export const keywords = pgTable("keywords", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  term: text("term").notNull(),
  status: text("status").notNull().default("active"), // active|paused
  lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// channel_connections
export const channelConnections = pgTable(
  "channel_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    externalAccountId: text("external_account_id"),
    accessTokenEnc: text("access_token_enc"), // encrypted via lib/db/encryption
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    status: text("status").notNull().default("connected"), // connected|expired|revoked|error
    metaJson: jsonb("meta_json").$type<Record<string, unknown>>(),
  },
  (t) => ({
    uq: uniqueIndex("channel_connections_brand_channel_uq").on(t.brandId, t.channel),
  }),
);

// cadence_settings
export const cadenceSettings = pgTable(
  "cadence_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    format: formatEnum("format").notNull(),
    perWeek: integer("per_week").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => ({
    uq: uniqueIndex("cadence_brand_channel_format_uq").on(t.brandId, t.channel, t.format),
  }),
);
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(phase-1): drizzle schema — brands + brand-config tables"
```

---

## Task 8: Drizzle schema — pipeline + support tables

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Append pipeline tables**

Append to `lib/db/schema.ts`:

```ts
// research_bundles
export const researchBundles = pgTable("research_bundles", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  pulledAt: timestamp("pulled_at", { withTimezone: true }).defaultNow().notNull(),
  competitorFindingsJson: jsonb("competitor_findings_json").$type<unknown>(),
  keywordFindingsJson: jsonb("keyword_findings_json").$type<unknown>(),
  trendingHashtagsJson: jsonb("trending_hashtags_json").$type<unknown>(),
  llmPatternSummary: text("llm_pattern_summary"),
  status: text("status").notNull().default("fresh"), // fresh|stale|partial
  errorNotes: text("error_notes"),
});

// briefs
export const briefStatusEnum = pgEnum("brief_status", [
  "pending_review",
  "approved",
  "edited",
  "rejected",
]);

export const briefs = pgTable("briefs", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  channel: channelEnum("channel").notNull(),
  format: formatEnum("format").notNull(),
  icpId: uuid("icp_id").references(() => icps.id, { onDelete: "set null" }),
  researchBundleId: uuid("research_bundle_id").references(() => researchBundles.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  hook: text("hook"),
  angle: text("angle"),
  keyMessage: text("key_message"),
  suggestedHashtags: text("suggested_hashtags").array(),
  suggestedCta: text("suggested_cta"),
  inspirationPostRefs: jsonb("inspiration_post_refs").$type<unknown>(),
  targetPublishDate: date("target_publish_date"),
  status: briefStatusEnum("status").notNull().default("pending_review"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

// drafts
export const draftStatusEnum = pgEnum("draft_status", [
  "pending_review",
  "approved",
  "edited",
  "rejected",
  "awaiting_assets",
  "awaiting_final_review",
  "scheduled",
]);

export const drafts = pgTable("drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  briefId: uuid("brief_id").notNull().unique().references(() => briefs.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  channel: channelEnum("channel").notNull(),
  format: formatEnum("format").notNull(),
  caption: text("caption"),
  body: text("body"),
  scriptJson: jsonb("script_json").$type<unknown>(),
  slideJson: jsonb("slide_json").$type<unknown>(),
  imagePrompts: jsonb("image_prompts").$type<unknown>(),
  metaJson: jsonb("meta_json").$type<Record<string, unknown>>(),
  status: draftStatusEnum("status").notNull().default("pending_review"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

// assets (library)
export const assets = pgTable("assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // video|image|audio|graphic
  label: text("label"),
  tags: text("tags").array(),
  storageUrl: text("storage_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  durationSec: integer("duration_sec"),
  width: integer("width"),
  height: integer("height"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  source: text("source").notNull().default("uploaded"), // uploaded|generated|imported_from_post
  notes: text("notes"),
  archived: boolean("archived").notNull().default(false),
  externalSource: text("external_source"), // drive|dropbox|null
  externalId: text("external_id"),
  externalModifiedAt: timestamp("external_modified_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// draft_assets (join)
export const draftAssets = pgTable(
  "draft_assets",
  {
    draftId: uuid("draft_id").notNull().references(() => drafts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull().default(0),
    role: text("role").notNull().default("primary"), // primary|cover|b_roll
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.draftId, t.assetId, t.slotIndex] }),
  }),
);

// posts
export const postStatusEnum = pgEnum("post_status", [
  "queued",
  "publishing",
  "published",
  "failed",
]);

export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  draftId: uuid("draft_id").notNull().unique().references(() => drafts.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  channel: channelEnum("channel").notNull(),
  status: postStatusEnum("status").notNull().default("queued"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  externalPostId: text("external_post_id"),
  externalUrl: text("external_url"),
  externalContainerId: text("external_container_id"),
  publishError: text("publish_error"),
  publishAttempts: integer("publish_attempts").notNull().default(0),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// analytics_snapshots
export const analyticsSnapshots = pgTable("analytics_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  pulledAt: timestamp("pulled_at", { withTimezone: true }).defaultNow().notNull(),
  reach: integer("reach"),
  impressions: integer("impressions"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  saves: integer("saves"),
  watchTimeSec: integer("watch_time_sec"),
  videoViews: integer("video_views"),
  profileVisits: integer("profile_visits"),
  followsFromPost: integer("follows_from_post"),
  opens: integer("opens"),
  clicks: integer("clicks"),
  pageviews: integer("pageviews"),
  dwellSec: integer("dwell_sec"),
  rawJson: jsonb("raw_json").$type<unknown>(),
});

// brand_metrics_snapshots
export const brandMetricsSnapshots = pgTable("brand_metrics_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  channel: channelEnum("channel").notNull(),
  pulledAt: timestamp("pulled_at", { withTimezone: true }).defaultNow().notNull(),
  followerCount: integer("follower_count"),
  followingCount: integer("following_count"),
  totalPosts: integer("total_posts"),
  rawJson: jsonb("raw_json").$type<unknown>(),
});

// jobs (work queue)
export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(),
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").notNull().default("queued"), // queued|running|done|failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

// events (audit log)
export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  actor: text("actor").notNull().default("system"),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(phase-1): drizzle schema — pipeline + support tables"
```

---

## Task 9: Generate + apply initial migration

**Files:**
- Create: `drizzle/migrations/0000_*.sql` (generated)

- [ ] **Step 1: Ensure `DATABASE_URL` is set in `.env.local`**

Skip this whole task if you haven't provisioned Neon yet — come back to it.

- [ ] **Step 2: Generate migration**

Run: `npm run db:generate`
Expected: a new SQL file appears in `drizzle/migrations/0000_*.sql`. Drizzle-kit also updates `drizzle/migrations/meta/`.

- [ ] **Step 3: Apply to dev DB**

Run: `npm run db:push`
Expected: tables created on Neon. Verify with `psql $DATABASE_URL -c "\dt"` (or Neon SQL Editor).

- [ ] **Step 4: Apply to test DB**

Run: `DATABASE_URL=$DATABASE_URL_TEST npm run db:push`
Expected: same tables on test branch.

- [ ] **Step 5: Commit migration files**

```bash
git add drizzle/
git commit -m "feat(phase-1): initial database migration"
```

---

## Task 10: Seed two test brands

**Files:**
- Create: `lib/db/seed.ts`

- [ ] **Step 1: Write `lib/db/seed.ts`**

```ts
import "dotenv/config";
import { getDb } from "./client";
import { brands, icps, cadenceSettings } from "./schema";

async function main() {
  const db = getDb();

  // Idempotent: clear seeded brands by slug, insert fresh.
  const seedSlugs = ["wonderfly", "jordan-personal"];
  const existing = await db.query.brands.findMany({});
  for (const b of existing) {
    if (seedSlugs.includes(b.slug)) {
      console.log(`removing existing seed brand: ${b.slug}`);
    }
  }

  const [wonderfly] = await db
    .insert(brands)
    .values({
      name: "Wonderfly Athletics",
      slug: "wonderfly",
      status: "active",
      websiteUrl: "https://wonderflyathletics.com",
      description: "Premium athletic equipment for serious team-sport athletes.",
      personaJson: { archetype: "Hero", traits: ["scrappy", "honest", "builder-minded"], pov: "we" },
      voiceJson: {
        tone: { formal_casual: 0.7, serious_playful: 0.4, expert_approachable: 0.5, reserved_bold: 0.7 },
        emojiPolicy: "sparing",
        hashtagStyle: "niche-3-5",
        readingLevel: "standard",
        bannedWords: ["synergy", "game-changer"],
      },
      voiceFreeform: "Talks like a coach who's been in the locker room. Direct, no fluff.",
      voiceExamples: [{ text: "Saved this from a viewer DM..." }],
    })
    .onConflictDoUpdate({
      target: brands.slug,
      set: { name: "Wonderfly Athletics" },
    })
    .returning();

  const [personal] = await db
    .insert(brands)
    .values({
      name: "Jordan (Woodworking)",
      slug: "jordan-personal",
      status: "active",
      description: "First-person woodworking + DIY content for builders.",
      personaJson: { archetype: "Sage", traits: ["curious", "patient", "honest"], pov: "I" },
      voiceJson: {
        tone: { formal_casual: 0.85, serious_playful: 0.55, expert_approachable: 0.8, reserved_bold: 0.5 },
        emojiPolicy: "none",
        hashtagStyle: "niche-3-5",
        readingLevel: "standard",
        bannedWords: [],
      },
      voiceFreeform: "First-person, casual, teaches by showing the failure first.",
      voiceExamples: [{ text: "Stop. Don't cut yet." }],
    })
    .onConflictDoUpdate({
      target: brands.slug,
      set: { name: "Jordan (Woodworking)" },
    })
    .returning();

  // ICPs
  await db
    .insert(icps)
    .values([
      {
        brandId: wonderfly.id,
        name: "Competitive amateur athletes",
        description: "Adults playing in leagues, want pro-grade gear.",
        painPoints: ["bad equipment fails mid-game", "team budgets tight"],
        whereTheyHangOut: "#leaguelife, @localrec",
        contentTheyEngageWith: "gear breakdowns, locker room moments",
        isDefault: true,
      },
      {
        brandId: personal.id,
        name: "First-time DIY homeowners",
        description: "Adults tackling their first big project.",
        painPoints: ["overwhelmed by tool choices", "afraid of expensive mistakes"],
        whereTheyHangOut: "#diyhome, @homedepot",
        contentTheyEngageWith: "mistakes-to-avoid, tool comparisons",
        isDefault: true,
      },
    ])
    .onConflictDoNothing();

  // Cadence: Growth preset for each brand on Instagram
  const cadence = [
    { brandId: wonderfly.id, channel: "instagram" as const, format: "reel" as const, perWeek: 5 },
    { brandId: wonderfly.id, channel: "instagram" as const, format: "carousel" as const, perWeek: 2 },
    { brandId: personal.id, channel: "instagram" as const, format: "reel" as const, perWeek: 5 },
    { brandId: personal.id, channel: "instagram" as const, format: "carousel" as const, perWeek: 2 },
  ];
  for (const c of cadence) {
    await db.insert(cadenceSettings).values(c).onConflictDoNothing();
  }

  console.log("Seed complete:", { wonderfly: wonderfly.id, personal: personal.id });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add `dotenv` to devDependencies**

Run: `npm install -D dotenv`

- [ ] **Step 3: Run seed**

Run: `npm run db:seed`
Expected: `Seed complete: { wonderfly: <uuid>, personal: <uuid> }`

- [ ] **Step 4: Verify**

Run: `psql $DATABASE_URL -c "SELECT slug, name, status FROM brands;"`
Expected: two rows.

- [ ] **Step 5: Commit**

```bash
git add lib/db/seed.ts package.json package-lock.json
git commit -m "feat(phase-1): seed two test brands"
```

---

## Task 11: Schema roundtrip integration test

**Files:**
- Create: `tests/db-test-utils.ts`, `tests/db/schema-roundtrip.test.ts`

- [ ] **Step 1: Write `tests/db-test-utils.ts`**

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../lib/db/schema";

export function getTestDbOrSkip() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) return null;
  return drizzle(neon(url), { schema });
}
```

- [ ] **Step 2: Write `tests/db/schema-roundtrip.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { getTestDbOrSkip } from "../db-test-utils";
import { brands } from "../../lib/db/schema";
import { eq } from "drizzle-orm";

describe("schema roundtrip", () => {
  const db = getTestDbOrSkip();
  if (!db) {
    it.skip("DATABASE_URL_TEST not set — skipping integration tests", () => {});
    return;
  }

  it("insert + select brand", async () => {
    const slug = `roundtrip-${Date.now()}`;
    const [inserted] = await db
      .insert(brands)
      .values({ name: "Roundtrip", slug, status: "draft" })
      .returning();
    const found = await db.query.brands.findFirst({ where: eq(brands.id, inserted.id) });
    expect(found?.slug).toBe(slug);
    await db.delete(brands).where(eq(brands.id, inserted.id));
  });
});
```

- [ ] **Step 3: Run test**

Run: `npm test -- schema-roundtrip`
Expected: pass (if `DATABASE_URL_TEST` set) or skip cleanly.

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test(phase-1): schema roundtrip integration test"
```

---

## Task 12: Brand queries (TDD)

**Files:**
- Create: `tests/brands/queries.test.ts`, `lib/brands/queries.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/brands/queries.test.ts
import { describe, expect, it } from "vitest";
import { getTestDbOrSkip } from "../db-test-utils";
import { listBrands, getBrandBySlug } from "../../lib/brands/queries";
import { brands } from "../../lib/db/schema";

describe("brand queries", () => {
  const db = getTestDbOrSkip();
  if (!db) {
    it.skip("DATABASE_URL_TEST not set", () => {});
    return;
  }

  it("listBrands returns active brands sorted by name", async () => {
    const slug = `list-${Date.now()}`;
    await db.insert(brands).values({ name: "Zeta", slug: `${slug}-z`, status: "active" });
    await db.insert(brands).values({ name: "Alpha", slug: `${slug}-a`, status: "active" });

    const result = await listBrands(db);
    const names = result.map((b) => b.name);
    expect(names.indexOf("Alpha")).toBeLessThan(names.indexOf("Zeta"));
  });

  it("getBrandBySlug returns null for unknown slug", async () => {
    const got = await getBrandBySlug(db, "definitely-not-real-slug-xyz");
    expect(got).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL (no module)**

Run: `npm test -- brands`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/brands/queries.ts`**

```ts
import { eq, asc } from "drizzle-orm";
import { brands } from "../db/schema";
import type { getDb } from "../db/client";

type Db = ReturnType<typeof getDb>;

export async function listBrands(db: Db) {
  return db.query.brands.findMany({
    where: (b, { ne }) => ne(b.status, "archived"),
    orderBy: (b) => [asc(b.name)],
  });
}

export async function getBrandBySlug(db: Db, slug: string) {
  const result = await db.query.brands.findFirst({
    where: eq(brands.slug, slug),
  });
  return result ?? null;
}
```

- [ ] **Step 4: Run — PASS**

Run: `npm test -- brands`
Expected: 2 passed (or skipped if no DB).

- [ ] **Step 5: Commit**

```bash
git add lib/brands/queries.ts tests/brands/
git commit -m "feat(phase-1): brand queries"
```

---

## Task 13: Active-brand store (TDD)

**Files:**
- Create: `tests/stores/active-brand-store.test.ts`, `lib/stores/active-brand-store.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/stores/active-brand-store.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { useActiveBrand } from "../../lib/stores/active-brand-store";

describe("active-brand store", () => {
  beforeEach(() => {
    useActiveBrand.setState({ brandId: null, brandSlug: null });
  });

  it("starts with null brand", () => {
    expect(useActiveBrand.getState().brandSlug).toBeNull();
  });

  it("sets and reads active brand", () => {
    useActiveBrand.getState().setActive("uuid-1", "wonderfly");
    expect(useActiveBrand.getState().brandSlug).toBe("wonderfly");
    expect(useActiveBrand.getState().brandId).toBe("uuid-1");
  });

  it("clears active brand", () => {
    useActiveBrand.getState().setActive("uuid-1", "wonderfly");
    useActiveBrand.getState().clear();
    expect(useActiveBrand.getState().brandSlug).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `npm test -- active-brand`
Expected: module not found.

- [ ] **Step 3: Write `lib/stores/active-brand-store.ts`**

```ts
import { create } from "zustand";

interface ActiveBrandState {
  brandId: string | null;
  brandSlug: string | null;
  setActive: (brandId: string, brandSlug: string) => void;
  clear: () => void;
}

export const useActiveBrand = create<ActiveBrandState>((set) => ({
  brandId: null,
  brandSlug: null,
  setActive: (brandId, brandSlug) => set({ brandId, brandSlug }),
  clear: () => set({ brandId: null, brandSlug: null }),
}));
```

- [ ] **Step 4: Run — PASS**

Run: `npm test -- active-brand`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/stores/active-brand-store.ts tests/stores/
git commit -m "feat(phase-1): active-brand zustand store"
```

---

## Task 14: Theme + sidebar stores from template

**Files:**
- Create: `lib/stores/sidebar-store.ts`, `lib/theme/theme-context.tsx`

- [ ] **Step 1: Copy `lib/stores/sidebar-store.ts`** verbatim from template (`### lib/stores/sidebar-store.ts`).
- [ ] **Step 2: Copy `lib/theme/theme-context.tsx`** verbatim from template (`### lib/theme/theme-context.tsx`).
- [ ] **Step 3: Commit**

```bash
git add lib/stores/sidebar-store.ts lib/theme/
git commit -m "chore(phase-1): import theme + sidebar stores from template"
```

---

## Task 15: App shell — root layout + providers

**Files:**
- Create: `app/layout.tsx`, `app/providers.tsx`, `app/page.tsx`

- [ ] **Step 1: Write `app/providers.tsx`** (no AuthProvider)

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ThemeProvider } from "@/lib/theme/theme-context";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <ThemeProvider>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Write `app/layout.tsx`**

Adapt from template's `### app/layout.tsx`. Drop AuthProvider import. Final shape:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Content Engine",
  description: "Multi-brand content engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Write `app/page.tsx`** (root redirect)

```tsx
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { listBrands } from "@/lib/brands/queries";

export default async function RootPage() {
  const db = getDb();
  const brands = await listBrands(db);
  if (brands.length === 0) redirect("/home");
  redirect(`/${brands[0].slug}/dashboard`);
}
```

- [ ] **Step 4: Run dev server**

Run: `npm run dev`
Browser: http://localhost:3000 → basic auth prompt → on success → redirects to `/wonderfly/dashboard` (404 expected — page doesn't exist yet).

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/providers.tsx app/page.tsx
git commit -m "feat(phase-1): root layout + providers + redirect"
```

---

## Task 16: Layout components from template

**Files:**
- Create: `components/layout/app-layout.tsx`, `app-header.tsx`, `page-container.tsx`

- [ ] **Step 1: Copy template files** (drop auth-related props/imports from each)

`components/layout/page-container.tsx` — copy verbatim from template.

`components/layout/app-header.tsx` — copy from template, **remove** the `<UserMenu />` import + render. Replace with a simple theme toggle (use template's existing toggle if present; otherwise a placeholder div).

`components/layout/app-layout.tsx` — copy from template, **remove** any `<AuthGuard>` / `<RoleGuard>` wrapping. Final shape wraps children with sidebar + header.

- [ ] **Step 2: Build check**

Run: `npx next build`
Expected: builds (warnings about missing pages OK).

- [ ] **Step 3: Commit**

```bash
git add components/layout/
git commit -m "chore(phase-1): import layout components from template (auth stripped)"
```

---

## Task 17: Brand switcher component

**Files:**
- Create: `components/layout/brand-switcher.tsx`

- [ ] **Step 1: Write `components/layout/brand-switcher.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useActiveBrand } from "@/lib/stores/active-brand-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Plus } from "lucide-react";

interface BrandRow {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export function BrandSwitcher() {
  const router = useRouter();
  const params = useParams<{ brandSlug?: string }>();
  const setActive = useActiveBrand((s) => s.setActive);
  const activeSlug = useActiveBrand((s) => s.brandSlug);

  const { data: brands = [] } = useQuery<BrandRow[]>({
    queryKey: ["brands"],
    queryFn: async () => {
      const r = await fetch("/api/brands");
      if (!r.ok) throw new Error("Failed to load brands");
      return r.json();
    },
  });

  // Sync URL param → store
  useEffect(() => {
    if (params.brandSlug && brands.length) {
      const b = brands.find((x) => x.slug === params.brandSlug);
      if (b) setActive(b.id, b.slug);
    }
  }, [params.brandSlug, brands, setActive]);

  const current = brands.find((b) => b.slug === activeSlug) ?? brands[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          <span className="truncate">{current?.name ?? "Select brand"}</span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {brands.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onClick={() => router.push(`/${b.slug}/dashboard`)}
          >
            {b.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/onboarding")}>
          <Plus className="mr-2 size-4" /> Add brand
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Create `app/api/brands/route.ts`** (the brand-list endpoint)

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { listBrands } from "@/lib/brands/queries";

export async function GET() {
  const db = getDb();
  const brands = await listBrands(db);
  return NextResponse.json(brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug, status: b.status })));
}
```

- [ ] **Step 3: Commit**

```bash
git add components/layout/brand-switcher.tsx app/api/brands/route.ts
git commit -m "feat(phase-1): brand switcher + brands API"
```

---

## Task 18: Sidebar with workspace nav

**Files:**
- Create: `components/layout/sidebar.tsx`

- [ ] **Step 1: Write `components/layout/sidebar.tsx`**

Adapt template's sidebar; replace nav items with workspace pages. Use the active-brand slug from `useActiveBrand` to build links. Greyed channels (Blog/Newsletter/LinkedIn/TikTok/Pinterest) render as disabled items.

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Microscope,
  FileText,
  Pencil,
  Package,
  Calendar,
  TrendingUp,
  Instagram,
  Facebook,
  PenSquare,
  Mail,
  Linkedin,
  Music,
  Pin,
  Settings,
  Plus,
  Home,
} from "lucide-react";
import { useActiveBrand } from "@/lib/stores/active-brand-store";
import { useSidebarStore } from "@/lib/stores/sidebar-store";
import { BrandSwitcher } from "./brand-switcher";
import { cn } from "@/lib/utils";

interface NavItem {
  href: (slug: string) => string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

const WORKSPACE_NAV: NavItem[] = [
  { href: (s) => `/${s}/dashboard`, label: "Dashboard", icon: LayoutDashboard },
  { href: (s) => `/${s}/research`, label: "Research", icon: Microscope },
  { href: (s) => `/${s}/briefs`, label: "Briefs", icon: FileText },
  { href: (s) => `/${s}/drafts`, label: "Drafts", icon: Pencil },
  { href: (s) => `/${s}/assets`, label: "Assets", icon: Package },
  { href: (s) => `/${s}/calendar`, label: "Calendar", icon: Calendar },
  { href: (s) => `/${s}/analytics`, label: "Analytics", icon: TrendingUp },
];

const CHANNEL_NAV: NavItem[] = [
  { href: (s) => `/${s}/instagram`, label: "Instagram", icon: Instagram },
  { href: (s) => `/${s}/facebook`, label: "Facebook", icon: Facebook },
  { href: (s) => `/${s}/blog`, label: "Blog", icon: PenSquare, disabled: true },
  { href: (s) => `/${s}/newsletter`, label: "Newsletter", icon: Mail, disabled: true },
  { href: (s) => `/${s}/linkedin`, label: "LinkedIn", icon: Linkedin, disabled: true },
  { href: (s) => `/${s}/tiktok`, label: "TikTok", icon: Music, disabled: true },
  { href: (s) => `/${s}/pinterest`, label: "Pinterest", icon: Pin, disabled: true },
];

export function Sidebar() {
  const slug = useActiveBrand((s) => s.brandSlug);
  const pathname = usePathname();
  const expanded = useSidebarStore((s) => s.expanded);

  const renderItem = (item: NavItem) => {
    if (!slug || item.disabled) {
      return (
        <div
          key={item.label}
          className={cn(
            "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
            "text-muted-foreground/50 cursor-not-allowed",
          )}
          title={item.disabled ? "Coming soon" : "Pick a brand first"}
        >
          <item.icon className="size-4" />
          {expanded && <span>{item.label}</span>}
        </div>
      );
    }
    const href = item.href(slug);
    const active = pathname.startsWith(href);
    return (
      <Link
        key={item.label}
        href={href}
        className={cn(
          "flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors",
          active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        )}
      >
        <item.icon className="size-4" />
        {expanded && <span>{item.label}</span>}
      </Link>
    );
  };

  return (
    <aside className={cn("flex flex-col gap-2 p-2", expanded ? "w-64" : "w-14")}>
      <BrandSwitcher />
      <Link href="/home" className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50">
        <Home className="size-4" />
        {expanded && <span>Home</span>}
      </Link>
      <div className="h-px bg-border my-2" />
      <nav className="flex flex-col gap-0.5">{WORKSPACE_NAV.map(renderItem)}</nav>
      {expanded && <div className="px-2 text-xs uppercase text-muted-foreground mt-3">Channels</div>}
      <nav className="flex flex-col gap-0.5">{CHANNEL_NAV.map(renderItem)}</nav>
      <div className="mt-auto flex flex-col gap-0.5">
        <Link
          href={slug ? `/${slug}/settings` : "#"}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50"
        >
          <Settings className="size-4" />
          {expanded && <span>Settings</span>}
        </Link>
        <Link
          href="/onboarding"
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50"
        >
          <Plus className="size-4" />
          {expanded && <span>Add Brand</span>}
        </Link>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/layout/sidebar.tsx
git commit -m "feat(phase-1): sidebar with workspace + channel nav"
```

---

## Task 19: Brand workspace layout

**Files:**
- Create: `app/(brand)/layout.tsx`

- [ ] **Step 1: Write `app/(brand)/layout.tsx`**

```tsx
import { AppLayout } from "@/components/layout/app-layout";
import { notFound } from "next/navigation";

interface Props {
  children: React.ReactNode;
  params: Promise<{ brandSlug: string }>;
}

export default async function BrandLayout({ children, params }: Props) {
  const { brandSlug } = await params;
  if (!brandSlug || typeof brandSlug !== "string") notFound();
  return <AppLayout>{children}</AppLayout>;
}
```

(The actual brand resolution happens in the brand-switcher client component via the URL param. The layout just enforces the URL has a slug.)

- [ ] **Step 2: Commit**

```bash
git add app/\(brand\)/
git commit -m "feat(phase-1): brand workspace route group + layout"
```

---

## Task 20: Empty-state component + placeholder pages

**Files:**
- Create: `components/empty-state.tsx`
- Create: `app/(brand)/[brandSlug]/{dashboard,research,briefs,drafts,assets,calendar,analytics,instagram,facebook}/page.tsx`
- Create: `app/home/page.tsx`

- [ ] **Step 1: Write `components/empty-state.tsx`**

```tsx
import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/page-container";

interface Props {
  title: string;
  description?: string;
  children?: ReactNode;
}

export function EmptyState({ title, description, children }: Props) {
  return (
    <PageContainer>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-2 text-muted-foreground max-w-md">{description}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Create one placeholder page**

`app/(brand)/[brandSlug]/dashboard/page.tsx`:
```tsx
import { EmptyState } from "@/components/empty-state";

export default function DashboardPage() {
  return <EmptyState title="Dashboard" description="Your queue and weekly calendar live here. Coming in Phase 5." />;
}
```

- [ ] **Step 3: Repeat for each placeholder**

Same shape, different titles for: research, briefs, drafts, assets, calendar, analytics, instagram, facebook. Each with a one-line description noting which phase will fill it (Phases 2-6 per the spec's Section 14).

- [ ] **Step 4: Create `app/home/page.tsx`**

```tsx
import { EmptyState } from "@/components/empty-state";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <EmptyState title="Welcome to your Content Engine" description="Pick a brand from the sidebar to get started, or add a new one.">
      <Link href="/onboarding"><Button>Add Brand</Button></Link>
    </EmptyState>
  );
}
```

- [ ] **Step 5: Run dev server, click around**

Run: `npm run dev`
Verify: navigating between sidebar items hits each placeholder; URL updates; brand switcher re-routes.

- [ ] **Step 6: Commit**

```bash
git add app/ components/empty-state.tsx
git commit -m "feat(phase-1): placeholder pages for all workspace + channel routes"
```

---

## Task 21: Settings page — tabs scaffold + read-only views

**Files:**
- Create: `app/(brand)/[brandSlug]/settings/page.tsx`

- [ ] **Step 1: Write the settings page (server component, fetches data)**

```tsx
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getBrandBySlug } from "@/lib/brands/queries";
import { eq } from "drizzle-orm";
import { icps, competitors, inspirationAccounts, keywords, cadenceSettings, channelConnections } from "@/lib/db/schema";
import { PageContainer } from "@/components/layout/page-container";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";

interface Props { params: Promise<{ brandSlug: string }>; }

export default async function SettingsPage({ params }: Props) {
  const { brandSlug } = await params;
  const db = getDb();
  const brand = await getBrandBySlug(db, brandSlug);
  if (!brand) notFound();

  const [icpRows, compRows, inspRows, kwRows, cadRows, connRows] = await Promise.all([
    db.select().from(icps).where(eq(icps.brandId, brand.id)),
    db.select().from(competitors).where(eq(competitors.brandId, brand.id)),
    db.select().from(inspirationAccounts).where(eq(inspirationAccounts.brandId, brand.id)),
    db.select().from(keywords).where(eq(keywords.brandId, brand.id)),
    db.select().from(cadenceSettings).where(eq(cadenceSettings.brandId, brand.id)),
    db.select().from(channelConnections).where(eq(channelConnections.brandId, brand.id)),
  ]);

  const apiKeyStatuses = [
    { name: "ANTHROPIC_API_KEY", configured: !!process.env.ANTHROPIC_API_KEY },
    { name: "FIRECRAWL_API_KEY", configured: !!process.env.FIRECRAWL_API_KEY },
    { name: "APIFY_API_TOKEN", configured: !!process.env.APIFY_API_TOKEN },
    { name: "META_APP_ID", configured: !!process.env.META_APP_ID },
    { name: "BLOB_READ_WRITE_TOKEN", configured: !!process.env.BLOB_READ_WRITE_TOKEN },
    { name: "TOKEN_ENCRYPTION_KEY", configured: !!process.env.TOKEN_ENCRYPTION_KEY },
  ];

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold mb-4">Settings — {brand.name}</h1>
      <Tabs defaultValue="app" className="w-full">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="app">App</TabsTrigger>
          <TabsTrigger value="persona">Persona &amp; Voice</TabsTrigger>
          <TabsTrigger value="icps">ICPs</TabsTrigger>
          <TabsTrigger value="competitors">Competitors</TabsTrigger>
          <TabsTrigger value="inspiration">Inspiration</TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
          <TabsTrigger value="cadence">Cadence</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="app">
          <Card className="p-4">
            <h2 className="font-medium mb-2">API Keys (env vars only)</h2>
            <ul className="text-sm">
              {apiKeyStatuses.map((k) => (
                <li key={k.name} className="flex items-center justify-between py-1">
                  <code>{k.name}</code>
                  <span className={k.configured ? "text-green-600" : "text-amber-600"}>
                    {k.configured ? "✓ Configured" : "⚠ Missing"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Source of truth: Vercel env vars. To change a value, update Vercel and redeploy.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="persona">
          <Card className="p-4">
            <h2 className="font-medium mb-2">Persona &amp; Voice</h2>
            <pre className="text-xs whitespace-pre-wrap">{JSON.stringify({
              name: brand.name,
              slug: brand.slug,
              websiteUrl: brand.websiteUrl,
              description: brand.description,
              persona: brand.personaJson,
              voice: brand.voiceJson,
              voiceFreeform: brand.voiceFreeform,
              voiceExamples: brand.voiceExamples,
            }, null, 2)}</pre>
            <p className="text-xs text-muted-foreground mt-2">Editable in Phase 2.</p>
          </Card>
        </TabsContent>

        <TabsContent value="icps">
          <Card className="p-4">
            <h2 className="font-medium mb-2">ICPs ({icpRows.length})</h2>
            {icpRows.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="text-sm space-y-2">
                {icpRows.map((i) => (
                  <li key={i.id}>
                    <strong>{i.name}</strong>{i.isDefault ? " (default)" : ""}
                    {i.description && <p className="text-muted-foreground">{i.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="competitors">
          <Card className="p-4">
            <h2 className="font-medium mb-2">Competitors ({compRows.length})</h2>
            {compRows.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="text-sm">{compRows.map((c) => <li key={c.id}>{c.handle} ({c.platform})</li>)}</ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="inspiration">
          <Card className="p-4">
            <h2 className="font-medium mb-2">Inspiration Accounts ({inspRows.length})</h2>
            {inspRows.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="text-sm">{inspRows.map((c) => <li key={c.id}>{c.handle} ({c.platform})</li>)}</ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="keywords">
          <Card className="p-4">
            <h2 className="font-medium mb-2">Keywords ({kwRows.length})</h2>
            {kwRows.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="text-sm">{kwRows.map((k) => <li key={k.id}>{k.term} <span className="text-muted-foreground">({k.status})</span></li>)}</ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="cadence">
          <Card className="p-4">
            <h2 className="font-medium mb-2">Cadence</h2>
            {cadRows.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <table className="text-sm w-full">
                <thead><tr><th className="text-left">Channel</th><th className="text-left">Format</th><th className="text-right">Per week</th></tr></thead>
                <tbody>{cadRows.map((c) => (
                  <tr key={c.id}><td>{c.channel}</td><td>{c.format}</td><td className="text-right">{c.perWeek}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="channels">
          <Card className="p-4">
            <h2 className="font-medium mb-2">Connected Channels ({connRows.length})</h2>
            {connRows.length === 0 ? <p className="text-sm text-muted-foreground">None connected. OAuth comes in Phase 4.</p> : (
              <ul className="text-sm">{connRows.map((c) => <li key={c.id}>{c.channel} — {c.status}</li>)}</ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Drive / Dropbox sync coming later.</p>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev`
Visit `/wonderfly/settings`, check every tab renders seeded data correctly. Visit `/jordan-personal/settings`, confirm tab content changes per brand.

- [ ] **Step 3: Commit**

```bash
git add app/\(brand\)/\[brandSlug\]/settings/
git commit -m "feat(phase-1): read-only settings tabs surface seeded brand data"
```

---

## Task 22: Final integration verify + Phase 1 close

**Files:**
- Modify: `package.json` (no changes expected, sanity check)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all green (DB-backed tests skip cleanly if `DATABASE_URL_TEST` unset).

- [ ] **Step 2: Run typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero errors.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual end-to-end smoke**

Run: `npm run dev`. Verify:
- Browser shows basic-auth prompt; correct creds let you in, wrong creds reject.
- Root URL redirects to `/wonderfly/dashboard` (or `/home` if no brands seeded).
- Sidebar shows brand switcher with both seeded brands; clicking switches the URL.
- All workspace nav items render their placeholder; channels (IG/FB) render placeholders; greyed channels are visibly disabled.
- `/wonderfly/settings` shows seeded ICPs, cadence rows, persona JSON.
- `/jordan-personal/settings` shows different content.
- Theme toggle in header switches light/dark.
- Sidebar collapse toggle works.

- [ ] **Step 5: Tag the phase**

```bash
git tag phase-1-foundation
```

- [ ] **Step 6: Phase done**

Open Phase 2 plan when ready.

---

## What's NOT in this phase (verify scope)

- No editable forms in Settings — read-only display only. Phase 2 makes everything editable.
- No onboarding wizard — `/onboarding` route is referenced by buttons but not implemented. Phase 2.
- No LLM, Firecrawl, Apify, Meta, or Vercel Blob calls. SDKs are installed; usage is Phase 3+.
- No cron handlers. `vercel.json` exists but declares no jobs yet.
- No publish, asset upload, or analytics. All placeholders.
- No tests for UI components — Phase 1 leans on manual smoke + typecheck. UI tests in Phase 2 once forms exist.

---

## Skill references

- @superpowers:test-driven-development — for tasks 4, 5, 12, 13 (and any future TDD work)
- @superpowers:verification-before-completion — before claiming Phase 1 done
- @superpowers:subagent-driven-development — recommended execution mode
