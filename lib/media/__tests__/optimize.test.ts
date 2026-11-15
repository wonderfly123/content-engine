/**
 * Shrinking on arrival: `complete` hands the clip to the optimizer, and the worker's signed
 * callback swaps in the small copy. In-memory database; R2 and the optimizer endpoint are mocked.
 */
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
  return { current: null as unknown };
});

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeTestDb } = await import("@/app/api/__tests__/separation/world");
  return { ...actual, db: await makeTestDb() };
});
vi.mock("@/lib/auth/session", () => ({ getAccess: async () => state.current }));

const r2 = vi.hoisted(() => ({
  completeMultipartUpload: vi.fn(async () => undefined),
  presignGet: vi.fn((key: string, expires?: number) => `https://r2.test/get/${key}?exp=${expires}`),
  presignPut: vi.fn((key: string, expires?: number) => `https://r2.test/put/${key}?exp=${expires}`),
  headObject: vi.fn(async (): Promise<{ size: number; contentType: string | null; etag: string | null } | null> => null),
  deleteObject: vi.fn(async () => undefined),
}));
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, ...r2 };
});

import { POST as complete } from "@/app/api/conversations/[id]/uploads/[mediaId]/complete/route";
import { POST as optimized } from "@/app/api/media/optimized/route";
import { workspaceStorageBytes } from "@/lib/limits/storage";
import { recoverStuckOptimizing } from "@/lib/media/optimize";
import { signWorkerBody } from "@/lib/media/worker-signature";
import { buildMediaKey, buildOptimizedKey } from "@/lib/storage/keys";

const SECRET = "test-optimize-secret";
const JOB = "11111111-1111-4111-8111-111111111111";
let db: TestDb;
let a: Seeded;
let fetchMock: ReturnType<typeof vi.fn>;

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const row = async (id: string) => (await db.select().from(schema.mediaObjects).where(eq(schema.mediaObjects.id, id)))[0];
const completeReq = () =>
  new NextRequest("http://localhost/api/x", { method: "POST", body: JSON.stringify({ parts: [{ partNumber: 1, etag: '"e1"' }] }), headers: { "content-type": "application/json" } });
const callback = (payload: unknown, signature: string | null = signWorkerBody(SECRET, JSON.stringify(payload))) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-nekter-signature"] = signature;
  return optimized(new NextRequest("http://localhost/api/media/optimized", { method: "POST", body: JSON.stringify(payload), headers }));
};
const incomingKey = () => buildMediaKey({ workspaceId: a.workspaceId, conversationId: a.conversationId, filename: "Alpha clip.mov", id: a.mediaId, kind: "incoming" });
const outputKey = () => buildOptimizedKey({ workspaceId: a.workspaceId, conversationId: a.conversationId, id: a.mediaId });

/** Alpha's ready clip, put back into "processing" with a job in flight, its bytes in incoming/. */
async function processing(updatedAt = new Date()) {
  await db
    .update(schema.mediaObjects)
    .set({ status: "processing", optimizeJobId: JOB, originalSizeBytes: 2000, r2Key: incomingKey(), updatedAt })
    .where(eq(schema.mediaObjects.id, a.mediaId));
}
const okResult = (over: Record<string, unknown> = {}) => ({ jobId: JOB, mediaId: a.mediaId, ok: true, sizeBytes: 500, width: 1080, height: 1920, durationSec: 12.5, codec: "hevc", ...over });

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  state.current = a.user;
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.MODAL_OPTIMIZE_URL = "https://nekter--optimize-submit.modal.run";
  process.env.MODAL_OPTIMIZE_SECRET = SECRET;
  delete process.env.APP_URL;
});

describe("complete hands the clip to the optimizer", () => {
  it("marks it processing and sends the worker presigned links only", async () => {
    r2.headObject.mockResolvedValueOnce({ size: 2000, contentType: "video/quicktime", etag: '"x"' });
    const res = await complete(completeReq(), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }));
    expect(res.status).toBe(200);
    expect((await res.json()).clip.status).toBe("processing");
    const clip = await row(a.uploadingMediaId);
    expect(clip).toMatchObject({ status: "processing", uploadId: null, originalSizeBytes: 2000, sizeBytes: 2000 });
    expect(clip.optimizeJobId).toMatch(/^[0-9a-f-]{36}$/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://nekter--optimize-submit.modal.run");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    const job = JSON.parse(init.body as string);
    expect(Object.keys(job).sort()).toEqual(["callbackUrl", "jobId", "mediaId", "outputUrl", "sourceUrl"]);
    expect(job).toMatchObject({ jobId: clip.optimizeJobId, mediaId: clip.id, callbackUrl: "http://localhost/api/media/optimized" });
    expect(r2.presignGet).toHaveBeenCalledWith(clip.r2Key, 7200);
    expect(r2.presignPut).toHaveBeenCalledWith(`ws/${a.workspaceId}/conv/${a.conversationId}/raw/${clip.id}.mp4`, 7200);
  });

  it("uses APP_URL for the callback when set", async () => {
    process.env.APP_URL = "https://app.nekter.io/";
    r2.headObject.mockResolvedValueOnce({ size: 2000, contentType: "video/quicktime", etag: '"x"' });
    await complete(completeReq(), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }));
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).callbackUrl).toBe("https://app.nekter.io/api/media/optimized");
  });

  it("without MODAL_OPTIMIZE_URL the clip is ready at once, as uploaded", async () => {
    delete process.env.MODAL_OPTIMIZE_URL;
    r2.headObject.mockResolvedValueOnce({ size: 2000, contentType: "video/quicktime", etag: '"x"' });
    const res = await complete(completeReq(), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }));
    expect((await res.json()).clip.status).toBe("ready");
    expect(await row(a.uploadingMediaId)).toMatchObject({ status: "ready", optimizeError: null, originalSizeBytes: 2000 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the original when the optimizer refuses or cannot be reached", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
    r2.headObject.mockResolvedValueOnce({ size: 2000, contentType: "video/quicktime", etag: '"x"' });
    await complete(completeReq(), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }));
    const clip = await row(a.uploadingMediaId);
    expect(clip.status).toBe("ready");
    expect(clip.optimizeError).toContain("HTTP 500");
    expect(clip.r2Key).toContain("/raw/"); // the seeded key, untouched
  });
});

describe("the worker's callback", () => {
  it("refuses a missing or wrong signature with 403 and writes nothing", async () => {
    await processing();
    const before = await row(a.mediaId);
    expect((await callback(okResult(), null)).status).toBe(403);
    expect((await callback(okResult(), "0".repeat(64))).status).toBe(403);
    expect((await callback(okResult(), signWorkerBody("another-secret", JSON.stringify(okResult())))).status).toBe(403);
    // A valid signature is useless once the secret is not set.
    delete process.env.MODAL_OPTIMIZE_SECRET;
    expect((await callback(okResult())).status).toBe(403);
    expect(await row(a.mediaId)).toEqual(before);
    expect(r2.headObject).not.toHaveBeenCalled();
    expect(r2.deleteObject).not.toHaveBeenCalled();
  });

  it("swaps in the small copy and deletes the original", async () => {
    await processing();
    const usedBefore = await workspaceStorageBytes(a.workspaceId); // counts the original while processing
    r2.headObject.mockResolvedValueOnce({ size: 500, contentType: "video/mp4", etag: '"o"' });
    const res = await callback(okResult());
    expect(res.status).toBe(200);
    expect(r2.headObject).toHaveBeenCalledWith(outputKey());
    expect(await row(a.mediaId)).toMatchObject({ status: "ready", r2Key: outputKey(), sizeBytes: 500, originalSizeBytes: 2000, contentType: "video/mp4", optimizeError: null });
    expect(r2.deleteObject).toHaveBeenCalledTimes(1);
    expect(r2.deleteObject).toHaveBeenCalledWith(incomingKey());
    // Storage now counts the small copy instead of the original.
    expect(await workspaceStorageBytes(a.workspaceId)).toBe(usedBefore - 1500);
  });

  it("is a no-op for a repeated jobId", async () => {
    await processing();
    r2.headObject.mockResolvedValue({ size: 500, contentType: "video/mp4", etag: '"o"' });
    expect((await callback(okResult())).status).toBe(200);
    const after = await row(a.mediaId);
    vi.clearAllMocks();
    const again = await callback(okResult());
    expect(again.status).toBe(200);
    expect((await again.json()).applied).toBe(false);
    expect(await row(a.mediaId)).toEqual(after);
    expect(r2.deleteObject).not.toHaveBeenCalled();
    r2.headObject.mockReset();
  });

  it("keeps the original, with the error, when the worker failed", async () => {
    await processing();
    expect((await callback({ jobId: JOB, mediaId: a.mediaId, ok: false, error: "ffmpeg failed: Invalid data" })).status).toBe(200);
    expect(await row(a.mediaId)).toMatchObject({ status: "ready", r2Key: incomingKey(), sizeBytes: 2000, optimizeError: "ffmpeg failed: Invalid data" });
    expect(r2.deleteObject).not.toHaveBeenCalled();
  });

  it("keeps the original when the copy did not arrive complete", async () => {
    await processing();
    r2.headObject.mockResolvedValueOnce({ size: 499, contentType: "video/mp4", etag: '"o"' });
    await callback(okResult());
    const clip = await row(a.mediaId);
    expect(clip).toMatchObject({ status: "ready", r2Key: incomingKey(), sizeBytes: 2000 });
    expect(clip.optimizeError).toContain("did not arrive complete");
    expect(r2.deleteObject).toHaveBeenCalledWith(outputKey());
    expect(r2.deleteObject).not.toHaveBeenCalledWith(incomingKey());
  });

  it("ignores an unknown job and a job for another clip", async () => {
    await processing();
    const before = await row(a.mediaId);
    expect((await callback(okResult({ jobId: "22222222-2222-4222-8222-222222222222" }))).status).toBe(404);
    expect((await callback(okResult({ mediaId: a.uploadingMediaId }))).status).toBe(404);
    expect(await row(a.mediaId)).toEqual(before);
  });

  it("cleans up the copy of a job that answers after the clip was given up on", async () => {
    await processing(new Date(Date.now() - 3 * 60 * 60 * 1000));
    expect(await recoverStuckOptimizing()).toBe(1);
    const clip = await row(a.mediaId);
    expect(clip).toMatchObject({ status: "ready", r2Key: incomingKey() });
    expect(clip.optimizeError).toContain("2 hours");
    await callback(okResult());
    expect(await row(a.mediaId)).toMatchObject({ status: "ready", r2Key: incomingKey(), sizeBytes: 2000 });
    expect(r2.deleteObject).toHaveBeenCalledWith(outputKey());
  });
});

describe("stuck clips", () => {
  it("only gives up after 2 hours", async () => {
    await processing(new Date(Date.now() - 60 * 60 * 1000));
    expect(await recoverStuckOptimizing()).toBe(0);
    expect((await row(a.mediaId)).status).toBe("processing");
    expect(await recoverStuckOptimizing(new Date(Date.now() + 61 * 60 * 1000 + 1000))).toBe(1);
    expect((await row(a.mediaId)).status).toBe("ready");
  });
});
