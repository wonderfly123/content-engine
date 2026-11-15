import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
});
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeTestDb } = await import("@/app/api/__tests__/separation/world");
  return { ...actual, db: await makeTestDb() };
});

import { storageRoom, workspaceStorageBytes } from "../storage";

let db: TestDb;
let a: Seeded;
let b: Seeded;

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Beta", "00000000-0000-4000-8000-00000000000b");
});

describe("workspace storage allowance", () => {
  it("counts only the workspace's own files", async () => {
    await db.execute(sql`update assets set size_bytes = 700 where brand_id = ${a.brandId}`);
    await db.execute(sql`update assets set size_bytes = 5000 where brand_id = ${b.brandId}`);
    expect(await workspaceStorageBytes(a.workspaceId)).toBe(700);
    expect(await workspaceStorageBytes(b.workspaceId)).toBe(5000);
  });
  it("is full at the limit and has room below it", async () => {
    await db.execute(sql`update assets set size_bytes = 1000 where brand_id = ${a.brandId}`);
    expect(await storageRoom(a.workspaceId, 1001)).toMatchObject({ usedBytes: 1000, full: false });
    expect(await storageRoom(a.workspaceId, 1000)).toMatchObject({ usedBytes: 1000, full: true });
  });
});
