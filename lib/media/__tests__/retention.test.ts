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

import { getRawClipRetention, purgeExpiredRawClips, setRawClipRetention } from "../retention";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-20T12:00:00Z");
let db: TestDb;
let a: Seeded;
let removed: string[];
const remove = async (key: string) => void removed.push(key);

const close = (daysAgo: number) =>
  db.update(schema.conversations).set({ status: "closed", closedAt: new Date(NOW.getTime() - daysAgo * DAY) }).where(eq(schema.conversations.id, a.conversationId));
const clip = async () => (await db.select().from(schema.mediaObjects).where(eq(schema.mediaObjects.id, a.mediaId)))[0];

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  removed = [];
});

describe("raw clip retention", () => {
  it("defaults to forever and deletes nothing, even for long-finished threads", async () => {
    expect(await getRawClipRetention()).toBe("forever");
    await close(400);
    expect(await purgeExpiredRawClips(NOW, remove)).toEqual({ retention: "forever", deleted: 0, failed: 0 });
    expect(removed).toEqual([]);
  });

  it("never deletes clips of a video still in progress", async () => {
    await setRawClipRetention("after_post", a.user.userId);
    expect((await purgeExpiredRawClips(NOW, remove)).deleted).toBe(0);
    expect((await clip()).deletedAt).toBeNull();
  });

  it("deletes a finished thread's raw clips once the chosen days have passed, from R2 and the row", async () => {
    await setRawClipRetention("7d", a.user.userId);
    await close(6);
    expect((await purgeExpiredRawClips(NOW, remove)).deleted).toBe(0);
    await close(8);
    const result = await purgeExpiredRawClips(NOW, remove);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(removed).toContain((await clip()).r2Key);
    expect((await clip()).deletedAt).toEqual(NOW);
    // Already gone: not deleted twice.
    removed = [];
    await purgeExpiredRawClips(NOW, remove);
    expect(removed).toEqual([]);
  });

  it("right after posting means the next run", async () => {
    await setRawClipRetention("after_post", a.user.userId);
    await close(0);
    expect((await purgeExpiredRawClips(NOW, remove)).deleted).toBeGreaterThanOrEqual(1);
  });

  it("leaves the row in place when R2 refuses, so the next run retries", async () => {
    await setRawClipRetention("1d", a.user.userId);
    await close(2);
    const result = await purgeExpiredRawClips(NOW, async () => Promise.reject(new Error("r2 down")));
    expect(result.deleted).toBe(0);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect((await clip()).deletedAt).toBeNull();
  });
});
