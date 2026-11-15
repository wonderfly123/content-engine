import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tableNames, type TestDb } from "@/app/api/__tests__/separation/world";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
});
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeTestDb } = await import("@/app/api/__tests__/separation/world");
  return { ...actual, db: await makeTestDb() };
});

import { ensureWorkspace, provisionUser, type UserAdmin } from "../provision";

let db: TestDb;
const USER = "00000000-0000-4000-8000-0000000000aa";
const count = async (table: string) => Number(((await db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0] as { n: number }).n);

function fakeAdmin(existingAdmins: number) {
  const writes: Array<{ userId: string; meta: Record<string, unknown> }> = [];
  const admin: UserAdmin = {
    countActiveAdmins: async () => existingAdmins,
    setAppMetadata: async (userId, meta) => {
      writes.push({ userId, meta });
    },
  };
  return { admin, writes };
}

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
});

describe("first sign-in", () => {
  it("makes a new person an active user with a workspace they own, and no approval step", async () => {
    const { admin, writes } = fakeAdmin(1);
    const result = await provisionUser({ id: USER, email: "sam@example.test" }, admin);
    expect(result).toEqual({ refreshSession: true, isNew: true });
    expect(writes).toEqual([{ userId: USER, meta: { ce_role: "user", ce_status: "active" } }]);
    const rows = (await db.execute(sql`select w.name, m.role from workspace_members m join workspaces w on w.id = m.workspace_id where m.user_id = ${USER}`)).rows;
    expect(rows).toEqual([{ name: "Sam's workspace", role: "owner" }]);
  });

  it("makes the very first account the platform admin", async () => {
    const { admin, writes } = fakeAdmin(0);
    await provisionUser({ id: USER, email: "first@example.test" }, admin);
    expect(writes[0].meta).toEqual({ ce_role: "admin", ce_status: "active" });
  });

  it("changes nothing for someone already set up", async () => {
    const { admin, writes } = fakeAdmin(1);
    await provisionUser({ id: USER, email: "sam@example.test" }, admin);
    const again = await provisionUser({ id: USER, email: "sam@example.test", app_metadata: { ce_role: "user", ce_status: "active" } }, admin);
    expect(again).toEqual({ refreshSession: false, isNew: false });
    expect(writes).toHaveLength(1);
    expect(await count("workspaces")).toBe(1);
  });

  it("never re-enables a disabled account or changes its role", async () => {
    const { admin, writes } = fakeAdmin(1);
    await provisionUser({ id: USER, email: "sam@example.test", app_metadata: { ce_role: "user", ce_status: "disabled" } }, admin);
    expect(writes).toEqual([]);
  });

  it("creates only one workspace when two sign-ins land at once", async () => {
    const user = { id: USER, email: "sam@example.test" };
    const created = await Promise.all([ensureWorkspace(user), ensureWorkspace(user), ensureWorkspace(user)]);
    expect(created.filter(Boolean)).toHaveLength(1);
    expect(await count("workspaces")).toBe(1);
    expect(await count("workspace_members")).toBe(1);
  });

  it("keeps separate people in separate workspaces", async () => {
    await ensureWorkspace({ id: USER, email: "sam@example.test" });
    await ensureWorkspace({ id: "00000000-0000-4000-8000-0000000000bb", email: "alex@example.test" });
    expect(await count("workspaces")).toBe(2);
    const shared = (await db.execute(sql`select workspace_id from workspace_members group by workspace_id having count(*) > 1`)).rows;
    expect(shared).toEqual([]);
  });
});
