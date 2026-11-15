/**
 * Test world for the separation tests: a real (in-memory) Postgres built from the app's schema,
 * holding two workspaces that must never see each other.
 */
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import type { Access } from "@/lib/auth/access";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** Every piece of the victim's text carries this, so a leak shows up in any response. */
export const MARKER = "VICTIMDATA";

export interface Seeded {
  user: Access;
  workspaceId: string;
  brandId: string;
  slug: string;
  icpId: string;
  competitorId: string;
  inspirationId: string;
  keywordId: string;
  connectionId: string;
  bundleId: string;
  briefId: string;
  draftId: string;
  assetId: string;
  postId: string;
  jobId: string;
  campaignId: string;
  adSetId: string;
  adId: string;
}

export async function makeTestDb(): Promise<TestDb> {
  const db = drizzle(new PGlite(), { schema });
  // The CommonJS build: drizzle-kit's ES module build cannot be loaded by the test runner.
  const { pushSchema } = createRequire(import.meta.url)("drizzle-kit/api") as typeof import("drizzle-kit/api");
  const { apply } = await pushSchema(schema as unknown as Record<string, unknown>, db as never);
  await apply();
  return db;
}

/** One workspace with one of everything. `label` goes into every text field. */
export async function seedWorkspace(db: TestDb, label: string, userId: string): Promise<Seeded> {
  const slug = label.toLowerCase();
  const [ws] = await db.insert(schema.workspaces).values({ name: `${label} workspace` }).returning();
  await db.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId, role: "owner" });
  await db.insert(schema.workspaceCredentials).values([
    { workspaceId: ws.id, provider: "anthropic", secret: `${label}-anthropic-key` },
    { workspaceId: ws.id, provider: "firecrawl", secret: `${label}-firecrawl-key` },
  ]);
  const [brand] = await db
    .insert(schema.brands)
    .values({ workspaceId: ws.id, name: `${label} brand`, slug, status: "active", description: `${label} description`, voiceFreeform: `${label} voice` })
    .returning();
  const brandId = brand.id;
  const [icp] = await db.insert(schema.icps).values({ brandId, name: `${label} icp` }).returning();
  const [competitor] = await db.insert(schema.competitors).values({ brandId, handle: `${slug}_competitor`, platform: "ig" }).returning();
  const [inspiration] = await db.insert(schema.inspirationAccounts).values({ brandId, handle: `${slug}_inspiration`, platform: "ig" }).returning();
  const [keyword] = await db.insert(schema.keywords).values({ brandId, term: `${label} keyword` }).returning();
  const [connection] = await db
    .insert(schema.channelConnections)
    .values({ brandId, channel: "instagram", externalAccountId: `${slug}-ig`, accessToken: `${label}-token`, metaJson: { igBusinessId: `${slug}-ig`, adAccountId: `act_${slug}`, accountName: `@${slug}` } })
    .returning();
  await db.insert(schema.cadenceSettings).values({ brandId, channel: "instagram", format: "reel", perWeek: 3 });
  const [bundle] = await db.insert(schema.researchBundles).values({ brandId, llmPatternSummary: `${label} patterns` }).returning();
  const [brief] = await db
    .insert(schema.briefs)
    .values({ brandId, channel: "instagram", format: "reel", icpId: icp.id, researchBundleId: bundle.id, title: `${label} brief`, hook: `${label} hook` })
    .returning();
  const [draft] = await db
    .insert(schema.drafts)
    .values({ briefId: brief.id, brandId, channel: "instagram", format: "reel", caption: `${label} caption`, status: "awaiting_assets" })
    .returning();
  const [asset] = await db
    .insert(schema.assets)
    .values({ brandId, kind: "video", label: `${label} asset`, storageUrl: `https://files.test/${slug}/video.mp4`, thumbnailUrl: `https://files.test/${slug}/thumb.jpg`, mimeType: "video/mp4", sizeBytes: 1000 })
    .returning();
  await db.insert(schema.draftAssets).values({ draftId: draft.id, assetId: asset.id, slotIndex: 0, role: "primary" });
  const [post] = await db
    .insert(schema.posts)
    .values({ draftId: draft.id, brandId, channel: "instagram", status: "published", scheduledFor: new Date("2026-01-01T00:00:00Z"), publishedAt: new Date("2026-01-01T00:00:00Z"), externalPostId: `${slug}-post`, externalUrl: `https://instagram.test/${slug}` })
    .returning();
  await db.insert(schema.analyticsSnapshots).values({ postId: post.id, brandId, reach: 10, likes: 1 });
  await db.insert(schema.brandMetricsSnapshots).values({ brandId, channel: "instagram", followerCount: 100 });
  const [job] = await db.insert(schema.jobs).values({ kind: "research_pull", brandId, status: "failed", attempts: 3, lastError: `${label} job error` }).returning();
  await db.insert(schema.events).values({ entityType: "brand", entityId: brandId, brandId, toStatus: "active", note: `${label} event` });
  const campaignId = `${slug}-campaign`;
  const adSetId = `${slug}-adset`;
  const adId = `${slug}-ad`;
  await db.insert(schema.adCampaigns).values({ id: campaignId, brandId, adAccountId: `act_${slug}`, name: `${label} campaign` });
  await db.insert(schema.adSets).values({ id: adSetId, brandId, adAccountId: `act_${slug}`, campaignId, name: `${label} ad set` });
  await db.insert(schema.ads).values({ id: adId, brandId, adAccountId: `act_${slug}`, adsetId: adSetId, campaignId, name: `${label} ad` });
  await db.insert(schema.adInsights).values({ brandId, adAccountId: `act_${slug}`, adId, adsetId: adSetId, campaignId, day: "2026-01-01", spend: "5" });
  return {
    user: { userId, email: `${slug}@example.test`, role: "user", status: "active" },
    workspaceId: ws.id,
    brandId,
    slug,
    icpId: icp.id,
    competitorId: competitor.id,
    inspirationId: inspiration.id,
    keywordId: keyword.id,
    connectionId: connection.id,
    bundleId: bundle.id,
    briefId: brief.id,
    draftId: draft.id,
    assetId: asset.id,
    postId: post.id,
    jobId: job.id,
    campaignId,
    adSetId,
    adId,
  };
}

/** Every row of every table, as text, for "nothing changed" checks. */
export async function snapshot(db: TestDb): Promise<Record<string, string>> {
  const tables = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows as Array<{ tablename: string }>;
  const out: Record<string, string> = {};
  for (const { tablename } of tables) {
    const rows = (await db.execute(sql`select coalesce(json_agg(t order by t::text), '[]'::json)::text as rows from ${sql.identifier(tablename)} t`)).rows as Array<{ rows: string }>;
    out[tablename] = rows[0].rows;
  }
  return out;
}

/** Names of the tables in the test database. */
export async function tableNames(db: TestDb): Promise<string[]> {
  const rows = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows as Array<{ tablename: string }>;
  return rows.map((r) => r.tablename);
}

/** Every string that identifies the victim: their ids and the marker in their text. */
export function victimStrings(victim: Seeded): string[] {
  const ids = Object.entries(victim)
    .filter(([key, value]) => typeof value === "string" && key !== "slug")
    .map(([, value]) => value as string);
  return [MARKER, MARKER.toLowerCase(), ...ids];
}
