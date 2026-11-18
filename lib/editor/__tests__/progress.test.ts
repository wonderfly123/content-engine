/**
 * The editor's steps while it works: the worker's signed update replaces a running job's step
 * list, and nothing else. In-memory database.
 */
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
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
vi.mock("@/lib/auth/session", () => ({ getAccess: async () => null }));

import { POST as progressRoute } from "@/app/api/editor/progress/route";
import { signWorkerBody } from "@/lib/media/worker-signature";

const SECRET = "test-editor-secret";
let db: TestDb;
let a: Seeded;

const send = (payload: unknown, signature: string | null = signWorkerBody(SECRET, JSON.stringify(payload))) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-nekter-signature"] = signature;
  return progressRoute(new NextRequest("http://localhost/api/editor/progress", { method: "POST", body: JSON.stringify(payload), headers }));
};
const steps = [
  { label: "Downloading 15 clips", at: "2026-11-18T19:54:05.000Z" },
  { label: "Looking through the clips", at: "2026-11-18T19:54:40.000Z" },
];
async function job(status: "running" | "done") {
  const [row] = await db
    .insert(schema.editorJobs)
    .values({ workspaceId: a.workspaceId, conversationId: a.conversationId, brandId: a.brandId, kind: "first_cut", status, request: "make a story", model: "claude-opus-5-5", startedAt: new Date() })
    .returning();
  return row.id;
}
const progressOf = async (id: string) => (await db.select().from(schema.editorJobs).where(eq(schema.editorJobs.id, id)))[0].progress;

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  process.env.MODAL_EDITOR_SECRET = SECRET;
});

describe("editor progress", () => {
  it("stores a running job's steps", async () => {
    const id = await job("running");
    const res = await send({ jobId: id, steps });
    expect(res.status).toBe(200);
    expect(await progressOf(id)).toEqual(steps);
  });

  it("refuses an unsigned update", async () => {
    const id = await job("running");
    expect((await send({ jobId: id, steps }, null)).status).toBe(403);
    expect(await progressOf(id)).toEqual([]);
  });

  it("never touches a finished job", async () => {
    const id = await job("done");
    expect(await (await send({ jobId: id, steps })).json()).toEqual({ applied: false });
    expect(await progressOf(id)).toEqual([]);
  });

  it("rejects malformed steps", async () => {
    const id = await job("running");
    expect((await send({ jobId: id, steps: [{ label: "", at: "now" }] })).status).toBe(400);
  });
});
