/**
 * With the optimizer on, the first cut starts when a thread's last clip becomes ready, once.
 * In-memory database; R2, the optimizer and the editor worker are mocked.
 */
import { eq, sql } from "drizzle-orm";
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
  headObject: vi.fn(async () => ({ size: 500, contentType: "video/mp4", etag: '"e"' })),
  deleteObject: vi.fn(async () => undefined),
}));
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, ...r2 };
});

import { POST as optimized } from "@/app/api/media/optimized/route";
import { startFirstCutIfClipsReady } from "@/lib/editor/clips-ready";
import { REPLIES, startEditorJob } from "@/lib/editor/submit";
import { recoverStuckOptimizing } from "@/lib/media/optimize";
import { signWorkerBody } from "@/lib/media/worker-signature";
import { buildMediaKey } from "@/lib/storage/keys";

const OPT_SECRET = "test-optimize-secret";
const EDITOR = "https://nekter--editor-submit.modal.run";
let db: TestDb;
let a: Seeded;
let fetchMock: ReturnType<typeof vi.fn>;

const jobs = () => db.select().from(schema.editorJobs).where(eq(schema.editorJobs.conversationId, a.conversationId));
const bodies = async () => (await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, a.conversationId))).map((m) => m.body);
const editorCalls = () => fetchMock.mock.calls.filter(([url]) => url === EDITOR);

/** Puts a clip into "processing" with optimizer job `jobId`, its bytes in incoming/. */
async function processing(mediaId: string, jobId: string, updatedAt = new Date()) {
  const r2Key = buildMediaKey({ workspaceId: a.workspaceId, conversationId: a.conversationId, filename: "clip.mov", id: mediaId, kind: "incoming" });
  await db.update(schema.mediaObjects).set({ status: "processing", optimizeJobId: jobId, originalSizeBytes: 2000, r2Key, updatedAt }).where(eq(schema.mediaObjects.id, mediaId));
}
async function secondClip(): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.mediaObjects).values({
    id,
    workspaceId: a.workspaceId,
    brandId: a.brandId,
    conversationId: a.conversationId,
    kind: "raw",
    r2Key: buildMediaKey({ workspaceId: a.workspaceId, conversationId: a.conversationId, filename: "two.mov", id }),
    filename: "two.mov",
    contentType: "video/quicktime",
    sizeBytes: 2000,
    status: "ready",
    uploadedBy: a.user.userId,
    // Part of the batch that was sent: uploaded before its "Added 2 clips" message.
    createdAt: new Date(Date.now() - 60_000),
  });
  return id;
}
const done = (mediaId: string, jobId: string) => {
  const payload = { jobId, mediaId, ok: true, sizeBytes: 500, codec: "hevc" };
  const raw = JSON.stringify(payload);
  return optimized(new NextRequest("http://localhost/api/media/optimized", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-nekter-signature": signWorkerBody(OPT_SECRET, raw) } }));
};
const JOB1 = "11111111-1111-4111-8111-111111111111";
const JOB2 = "22222222-2222-4222-8222-222222222222";

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  // The seeded half-uploaded clip was cancelled: nothing of this batch is still uploading.
  await db.update(schema.mediaObjects).set({ status: "failed", deletedAt: new Date() }).where(eq(schema.mediaObjects.id, a.uploadingMediaId));
  // The batch's own message, stored while the clips were still processing.
  await db.insert(schema.conversationMessages).values({ conversationId: a.conversationId, direction: "out", channel: "app", body: "Added 2 clips (4 KB)" });
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.MODAL_OPTIMIZE_SECRET = OPT_SECRET;
  process.env.MODAL_EDITOR_URL = EDITOR;
  process.env.MODAL_EDITOR_SECRET = "test-editor-secret";
  process.env.APP_URL = "https://app.test";
});

afterEach(() => {
  for (const k of ["MODAL_OPTIMIZE_SECRET", "MODAL_EDITOR_URL", "MODAL_EDITOR_SECRET", "APP_URL"]) delete process.env[k];
});

describe("first cut when the last clip is ready", () => {
  it("the last clip finishing optimizing starts the first cut and says so", async () => {
    await processing(a.mediaId, JOB1);
    expect((await done(a.mediaId, JOB1)).status).toBe(200);
    const [job] = await jobs();
    expect(job).toMatchObject({ status: "running", kind: "first_cut" });
    expect(editorCalls()).toHaveLength(1);
    expect(await bodies()).toContain(REPLIES.firstCut);
  });

  it("a clip finishing while another is still processing starts nothing; the last one does", async () => {
    const two = await secondClip();
    await processing(a.mediaId, JOB1);
    await processing(two, JOB2);
    await done(a.mediaId, JOB1);
    expect(await jobs()).toHaveLength(0);
    expect(editorCalls()).toHaveLength(0);
    await done(two, JOB2);
    expect(await jobs()).toHaveLength(1);
    expect(editorCalls()).toHaveLength(1);
  });

  it("a batch sent while one clip is ready and another still processing waits, then cuts with both", async () => {
    const two = await secondClip();
    await processing(a.mediaId, JOB1);
    const added = (await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, a.conversationId))).find((m) => m.body.startsWith("Added "))!;
    expect(await startEditorJob(a.conversationId, added.id)).toMatchObject({ queued: false, reason: "clips still processing" });
    expect(await jobs()).toHaveLength(0);
    expect(editorCalls()).toHaveLength(0);
    await done(a.mediaId, JOB1);
    const [job] = await jobs();
    expect([...(job.clipIds as string[])].sort()).toEqual([a.mediaId, two].sort());
  });

  it("two callbacks at the same moment start one job, and say so once", async () => {
    const two = await secondClip();
    await processing(a.mediaId, JOB1);
    await processing(two, JOB2);
    await Promise.all([done(a.mediaId, JOB1), done(two, JOB2)]);
    expect(await jobs()).toHaveLength(1);
    expect((await bodies()).filter((b) => b === REPLIES.firstCut || b === REPLIES.busy)).toEqual([REPLIES.firstCut]);
  });

  it("two hand-offs racing to the insert: the unique index lets one through, the other counts as started", async () => {
    const results = await Promise.all([startFirstCutIfClipsReady(a.conversationId), startFirstCutIfClipsReady(a.conversationId), startFirstCutIfClipsReady(a.conversationId)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
    expect((await bodies()).filter((b) => b === REPLIES.firstCut || b === REPLIES.busy)).toEqual([REPLIES.firstCut]);
  });

  it("a clip the sweep gives up on counts as ready too", async () => {
    await processing(a.mediaId, JOB1, new Date(Date.now() - 3 * 60 * 60 * 1000));
    expect(await recoverStuckOptimizing()).toBe(1);
    expect(await jobs()).toHaveLength(1);
  });

  it("starts nothing while a clip is still uploading", async () => {
    await db.update(schema.mediaObjects).set({ status: "uploading", deletedAt: null }).where(eq(schema.mediaObjects.id, a.uploadingMediaId));
    await processing(a.mediaId, JOB1);
    await done(a.mediaId, JOB1);
    expect(await jobs()).toHaveLength(0);
  });

  it("starts nothing for a clip added after the batch was sent, or before any batch is sent", async () => {
    // A clip that finished uploading after the last "Added" message: the person has not tapped Send for it.
    await db.insert(schema.mediaObjects).values({
      id: crypto.randomUUID(),
      workspaceId: a.workspaceId,
      brandId: a.brandId,
      conversationId: a.conversationId,
      kind: "raw",
      r2Key: buildMediaKey({ workspaceId: a.workspaceId, conversationId: a.conversationId, filename: "late.mov", id: crypto.randomUUID() }),
      filename: "late.mov",
      contentType: "video/quicktime",
      sizeBytes: 2000,
      status: "ready",
      uploadedBy: a.user.userId,
      createdAt: new Date(Date.now() + 60_000),
    });
    expect(await startFirstCutIfClipsReady(a.conversationId)).toBe(false);
    await db.delete(schema.mediaObjects).where(eq(schema.mediaObjects.filename, "late.mov"));
    await db.delete(schema.conversationMessages).where(eq(schema.conversationMessages.body, "Added 2 clips (4 KB)"));
    expect(await startFirstCutIfClipsReady(a.conversationId)).toBe(false);
    expect(await jobs()).toHaveLength(0);
  });

  it("starts nothing once the thread already has a job, or before it has a brand", async () => {
    await startFirstCutIfClipsReady(a.conversationId);
    expect(await startFirstCutIfClipsReady(a.conversationId)).toBe(false);
    expect(await jobs()).toHaveLength(1);
    await db.delete(schema.editorJobs);
    await db.execute(sql`update conversations set brand_id = null where id = ${a.conversationId}`);
    expect(await startFirstCutIfClipsReady(a.conversationId)).toBe(false);
    expect(await jobs()).toHaveLength(0);
  });
});
