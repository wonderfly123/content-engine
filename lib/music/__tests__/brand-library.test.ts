/**
 * Per-brand music libraries: seeding a new brand from the platform library (once), what jobs get,
 * what the callback accepts, and managing one brand's tracks. In-memory database.
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
import * as schema from "@/lib/db/schema";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
});
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeTestDb } = await import("@/app/api/__tests__/separation/world");
  return { ...actual, db: await makeTestDb() };
});

import {
  addBrandTrack,
  brandUploadKey,
  ensureBrandTracks,
  isBrandUploadKey,
  listBrandTracks,
  setBrandTrackActive,
  tracksForBrand,
  usableTracks,
} from "../library";

let db: TestDb;
let a: Seeded;
let b: Seeded;

const track = (title: string, over: Partial<typeof schema.musicTracks.$inferInsert> = {}) => ({
  title,
  r2Key: `music/library/${title.toLowerCase().replace(/\s+/g, "-")}.mp3`,
  seconds: 120,
  source: "test",
  ...over,
});
const brandRows = (brandId: string) => db.select().from(schema.musicTracks).where(eq(schema.musicTracks.brandId, brandId));
const newBrand = async (workspaceId: string, slug: string) =>
  (await db.insert(schema.brands).values({ workspaceId, name: slug, slug, status: "draft" }).returning())[0];
const settings = async (brandId: string) => (await db.select().from(schema.brands).where(eq(schema.brands.id, brandId)))[0].settingsJson;

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Bravo", "00000000-0000-4000-8000-00000000000b");
  await db.insert(schema.musicTracks).values([track("Platform Song", { bpm: 120 }), track("Platform Off", { active: false }), track("Alpha Legacy", { workspaceId: a.workspaceId })]);
});

describe("ensureBrandTracks", () => {
  it("copies the platform library (not legacy workspace tracks) into a new brand, once, keeping on/off and beat data", async () => {
    const fresh = await newBrand(a.workspaceId, "fresh");
    await ensureBrandTracks(fresh.id, a.workspaceId);
    await ensureBrandTracks(fresh.id, a.workspaceId);
    const rows = await brandRows(fresh.id);
    expect(rows.map((t) => [t.title, t.active, t.bpm, t.workspaceId]).sort()).toEqual([
      ["Platform Off", false, null, a.workspaceId],
      ["Platform Song", true, 120, a.workspaceId],
    ]);
    expect(await settings(fresh.id)).toMatchObject({ musicSeeded: true });
  });

  it("never refills a brand that removed every track", async () => {
    const fresh = await newBrand(a.workspaceId, "fresh");
    await ensureBrandTracks(fresh.id, a.workspaceId);
    await db.delete(schema.musicTracks).where(eq(schema.musicTracks.brandId, fresh.id));
    expect(await listBrandTracks(fresh.id, a.workspaceId)).toEqual([]);
    expect(await tracksForBrand(fresh.id, a.workspaceId)).toEqual([]);
  });

  it("only marks a brand that already has tracks, and keeps other settings", async () => {
    await db.update(schema.brands).set({ settingsJson: { enabledChannels: ["instagram"] } }).where(eq(schema.brands.id, a.brandId));
    await ensureBrandTracks(a.brandId, a.workspaceId);
    expect((await brandRows(a.brandId)).map((t) => t.title)).toEqual(["Alpha track"]);
    expect(await settings(a.brandId)).toEqual({ enabledChannels: ["instagram"], musicSeeded: true });
  });

  it("does nothing for a brand of another workspace, or while the platform library is empty", async () => {
    await ensureBrandTracks(b.brandId, a.workspaceId);
    expect(await settings(b.brandId)).toEqual({});
    await db.delete(schema.musicTracks).where(eq(schema.musicTracks.workspaceId, a.workspaceId));
    await db.delete(schema.musicTracks).where(sql`${schema.musicTracks.workspaceId} is null`);
    const fresh = await newBrand(a.workspaceId, "fresh");
    await ensureBrandTracks(fresh.id, a.workspaceId);
    expect(await settings(fresh.id)).toEqual({});
  });
});

describe("usableTracks", () => {
  it("accepts the brand's own and legacy rows (platform or this workspace), never another brand's or workspace's", async () => {
    const sibling = await newBrand(a.workspaceId, "sibling");
    await ensureBrandTracks(sibling.id, a.workspaceId);
    const [siblingTrack] = await brandRows(sibling.id);
    const all = await db.select().from(schema.musicTracks);
    const id = (title: string, brandId: string | null = null) => all.find((t) => t.title === title && t.brandId === brandId)!.id;
    const [bravoLegacy] = await db.insert(schema.musicTracks).values(track("Bravo Legacy", { workspaceId: b.workspaceId })).returning();
    const ids = [a.musicTrackId, id("Platform Song"), id("Alpha Legacy"), siblingTrack.id, b.musicTrackId, bravoLegacy.id];
    const usable = await usableTracks({ workspaceId: a.workspaceId, brandId: a.brandId }, ids);
    expect([...usable.values()].map((t) => t.title).sort()).toEqual(["Alpha Legacy", "Alpha track", "Platform Song"]);
    const noBrand = await usableTracks({ workspaceId: a.workspaceId, brandId: null }, ids);
    expect([...noBrand.values()].map((t) => t.title).sort()).toEqual(["Alpha Legacy", "Platform Song"]);
  });
});

describe("managing a brand's tracks", () => {
  it("adds an upload to the brand only, and turns only the brand's own tracks on or off", async () => {
    const key = brandUploadKey(a.brandId, "abc", "My Song.mp3");
    const added = await addBrandTrack({ brandId: a.brandId, workspaceId: a.workspaceId, key, title: "My Song", seconds: 33 });
    expect(added).toMatchObject({ brandId: a.brandId, workspaceId: a.workspaceId, r2Key: key, source: "upload", active: true });
    expect(await setBrandTrackActive(a.brandId, a.workspaceId, added.id, false)).toBe(true);
    expect(await setBrandTrackActive(a.brandId, a.workspaceId, b.musicTrackId, false)).toBe(false);
    expect(await setBrandTrackActive(b.brandId, b.workspaceId, added.id, true)).toBe(false);
    expect((await listBrandTracks(a.brandId, a.workspaceId)).map((t) => [t.title, t.active])).toEqual([["Alpha track", true], ["My Song", false]]);
    expect((await tracksForBrand(a.brandId, a.workspaceId)).map((t) => t.title)).toEqual(["Alpha track"]);
  });

  it("keys uploads under the brand's own folder and accepts only those keys", () => {
    const key = brandUploadKey(a.brandId, "abc", "../My Song.m4a");
    expect(key).toBe(`music/library/uploads/${a.brandId}/abc-.-my-song.m4a`);
    expect(isBrandUploadKey(a.brandId, key)).toBe(true);
    expect(isBrandUploadKey(b.brandId, key)).toBe(false);
    expect(isBrandUploadKey(a.brandId, `music/library/uploads/${a.brandId}/x/../../${b.brandId}/y.mp3`)).toBe(false);
    expect(isBrandUploadKey(a.brandId, `music/library/uploads/${a.brandId}/`)).toBe(false);
    expect(isBrandUploadKey(a.brandId, "music/library/uploads/abc-song.mp3")).toBe(false);
  });
});
