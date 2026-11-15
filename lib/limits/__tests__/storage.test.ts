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
  beforeEach(async () => {
    // The test world seeds clips on R2 too; start each test with none counted.
    await db.execute(sql`update media_objects set size_bytes = 0`);
  });
  it("counts only the workspace's own files", async () => {
    await db.execute(sql`update assets set size_bytes = 700 where brand_id = ${a.brandId}`);
    await db.execute(sql`update assets set size_bytes = 5000 where brand_id = ${b.brandId}`);
    expect(await workspaceStorageBytes(a.workspaceId)).toBe(700);
    expect(await workspaceStorageBytes(b.workspaceId)).toBe(5000);
  });
  it("adds the workspace's media objects that are not deleted", async () => {
    await db.execute(sql`update assets set size_bytes = 700 where brand_id = ${a.brandId}`);
    await db.execute(sql`update media_objects set size_bytes = 300 where workspace_id = ${a.workspaceId}`);
    await db.execute(sql`update media_objects set size_bytes = 9000 where workspace_id = ${b.workspaceId}`);
    // Two clips of 300 (one ready, one uploading).
    expect(await workspaceStorageBytes(a.workspaceId)).toBe(1300);
    await db.execute(sql`update media_objects set deleted_at = now() where id = ${a.uploadingMediaId}`);
    expect(await workspaceStorageBytes(a.workspaceId)).toBe(1000);
  });
  it("is full at the limit and has room below it", async () => {
    await db.execute(sql`update assets set size_bytes = 1000 where brand_id = ${a.brandId}`);
    expect(await storageRoom(a.workspaceId, 1001)).toMatchObject({ usedBytes: 1000, full: false });
    expect(await storageRoom(a.workspaceId, 1000)).toMatchObject({ usedBytes: 1000, full: true });
  });
});

describe("per-workspace allowance", () => {
  it("uses the default until the workspace has its own allowance", async () => {
    const { storageRoom: room, STORAGE_LIMIT_BYTES } = await import("../storage");
    expect((await room(a.workspaceId)).limitBytes).toBe(STORAGE_LIMIT_BYTES);
    await db.execute(sql`update workspaces set storage_limit_bytes = ${100 * 1024 ** 3} where id = ${a.workspaceId}`);
    expect((await room(a.workspaceId)).limitBytes).toBe(100 * 1024 ** 3);
    expect((await room(b.workspaceId)).limitBytes).toBe(STORAGE_LIMIT_BYTES);
  });
});
