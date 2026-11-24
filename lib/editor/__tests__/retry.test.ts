/**
 * A crashed edit is tried once more by itself: the first failure of a request starts the same
 * request again and says so; a second failure asks the person to send it again.
 * In-memory database; R2 and the editor worker are mocked.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const r2 = vi.hoisted(() => ({
  presignGet: vi.fn((key: string) => `https://r2.test/get/${key}`),
  presignPut: vi.fn((key: string) => `https://r2.test/put/${key}`),
}));
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, ...r2 };
});

import { POST as callbackRoute } from "@/app/api/editor/callback/route";
import { FAILED_MESSAGE, RETRY_MESSAGE } from "@/lib/editor/callback";
import { startEditorJob } from "@/lib/editor/submit";
import { signWorkerBody } from "@/lib/media/worker-signature";

const SECRET = "test-editor-secret";
const EDITOR = "https://nekter--editor-submit.modal.run";
let db: TestDb;
let a: Seeded;
let fetchMock: ReturnType<typeof vi.fn>;
let clipsMessageId: string;

const jobs = () => db.select().from(schema.editorJobs).where(eq(schema.editorJobs.conversationId, a.conversationId)).orderBy(asc(schema.editorJobs.createdAt));
const said = async () =>
  (await db.select().from(schema.conversationMessages).where(and(eq(schema.conversationMessages.conversationId, a.conversationId), eq(schema.conversationMessages.direction, "out")))).map((m) => m.body);
const editorCalls = () => fetchMock.mock.calls.filter(([url]) => url === EDITOR);
const crash = (jobId: string) => {
  const payload = { jobId, ok: false, error: "The editor could not run (CLIJSONDecodeError).", manifest: null, reply: "Something went wrong.", question: null, usage: null };
  const raw = JSON.stringify(payload);
  return callbackRoute(new NextRequest("http://localhost/api/editor/callback", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-nekter-signature": signWorkerBody(SECRET, raw) } }));
};

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  // The seeded half-uploaded clip was cancelled; the batch's own message is what the edit answers.
  await db.update(schema.mediaObjects).set({ status: "failed", deletedAt: new Date() }).where(eq(schema.mediaObjects.id, a.uploadingMediaId));
  const [message] = await db
    .insert(schema.conversationMessages)
    .values({ conversationId: a.conversationId, direction: "in", channel: "app", body: "Added 1 clip (2 KB)" })
    .returning();
  clipsMessageId = message.id;
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.MODAL_EDITOR_URL = EDITOR;
  process.env.MODAL_EDITOR_SECRET = SECRET;
  process.env.APP_URL = "https://app.test";
});

afterEach(() => {
  for (const k of ["MODAL_EDITOR_URL", "MODAL_EDITOR_SECRET", "APP_URL"]) delete process.env[k];
});

describe("a crashed edit", () => {
  it("is started again once, and says so instead of asking the person to resend", async () => {
    expect((await startEditorJob(a.conversationId, clipsMessageId)).queued).toBe(true);
    const [first] = await jobs();
    expect((await crash(first.id)).status).toBe(200);

    const after = await jobs();
    expect(after.map((j) => j.status)).toEqual(["failed", "running"]);
    expect(after[0].error).toContain("CLIJSONDecodeError");
    expect(after[1]).toMatchObject({ kind: "first_cut", triggerMessageId: clipsMessageId });
    expect(editorCalls()).toHaveLength(2);
    expect(await said()).toEqual([RETRY_MESSAGE]);
  });

  it("is not started a third time: the second failure asks the person to send it again", async () => {
    await startEditorJob(a.conversationId, clipsMessageId);
    await crash((await jobs())[0].id);
    await crash((await jobs())[1].id);

    expect((await jobs()).map((j) => j.status)).toEqual(["failed", "failed"]);
    expect(editorCalls()).toHaveLength(2);
    expect(await said()).toEqual([RETRY_MESSAGE, FAILED_MESSAGE]);
  });

  it("falls back to asking when the retry cannot start", async () => {
    await startEditorJob(a.conversationId, clipsMessageId);
    const [first] = await jobs();
    fetchMock.mockImplementation(async () => new Response("no", { status: 500 }));
    await crash(first.id);
    expect(await said()).toEqual([FAILED_MESSAGE]);
  });
});
