# Content Engine

Single-user, multi-brand content pipeline: research → brief → draft → asset → schedule → publish → analytics. Instagram + Facebook in v1.

See `docs/superpowers/specs/` for the foundation design spec.

## Quick start

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev
```

All requests are gated by HTTP Basic Auth at the edge (`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`). Cron routes (`/api/cron/*`) authenticate via `CRON_SECRET` header instead.

## Scripts

- `npm run dev` — Next.js dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript no-emit check
- `npm run lint` — ESLint via `eslint-config-next`
- `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle Kit

## Stack

Next.js 15 (App Router), React 19, Tailwind v4, shadcn/ui, Drizzle + Neon Postgres, Vercel Blob, Anthropic Claude, Firecrawl, Apify, Meta Graph API. Deploys on Vercel (Pro plan required for sub-daily cron schedules).
