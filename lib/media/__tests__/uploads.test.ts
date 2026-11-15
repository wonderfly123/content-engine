/**
 * The clip upload routes against the in-memory database, with every R2 call mocked.
 */
import { and, eq, sql } from "drizzle-orm";
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
  createMultipartUpload: vi.fn(async () => "upload-1"),
  completeMultipartUpload: vi.fn(async () => undefined),
  abortMultipartUpload: vi.fn(async () => undefined),
  presignUploadPart: vi.fn((key: string, _uploadId: string, n: number) => `https://r2.test/${key}?partNumber=${n}`),
  presignGet: vi.fn((key: string) => `https://r2.test/${key}?signed`),
  headObject: vi.fn(async (): Promise<{ size: number; contentType: string | null; etag: string | null } | null> => null),
  deleteObject: vi.fn(async () => undefined),
}));
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, ...r2 };
});
const editor = vi.hoisted(() => ({ handOffToEditor: vi.fn(async () => ({ queued: false, reason: "editor not connected yet" })) }));
vi.mock("@/lib/conversations/editor", async () => {
  const actual = await vi.importActual<typeof import("@/lib/conversations/editor")>("@/lib/conversations/editor");
  return { ...actual, ...editor };
});

import { POST as start } from "@/app/api/conversations/[id]/uploads/route";
import { POST as parts } from "@/app/api/conversations/[id]/uploads/[mediaId]/parts/route";
import { POST as complete } from "@/app/api/conversations/[id]/uploads/[mediaId]/complete/route";
import { POST as abort } from "@/app/api/conversations/[id]/uploads/[mediaId]/abort/route";
import { POST as done } from "@/app/api/conversations/[id]/uploads/done/route";
import { GET as media } from "@/app/api/media/[mediaId]/route";
import { STORAGE_LIMIT_BYTES } from "@/lib/limits/storage";
import { planParts } from "@/lib/media/rules";

let db: TestDb;
let a: Seeded;
let b: Seeded;

const GB = 1024 ** 3;
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const row = async (id: string) => (await db.select().from(schema.mediaObjects).where(eq(schema.mediaObjects.id, id)))[0];
const startClip = (who: Seeded, body: Record<string, unknown>) => start(req(body), ctx({ id: who.conversationId }));

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Beta", "00000000-0000-4000-8000-00000000000b");
  state.current = a.user;
  vi.clearAllMocks();
  delete process.env.MODAL_OPTIMIZE_URL;
  delete process.env.MODAL_OPTIMIZE_SECRET;
});

describe("starting an upload", () => {
  it("creates an uploading clip and a multipart upload, 16 MB parts", async () => {
    const res = await startClip(a, { filename: "Beach day.MOV", size: 40 * 1024 ** 2, contentType: "" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ partSize: 16 * 1024 ** 2, partCount: 3 });
    const clip = await row(json.mediaId);
    expect(clip).toMatchObject({ status: "uploading", uploadId: "upload-1", workspaceId: a.workspaceId, conversationId: a.conversationId, contentType: "video/quicktime", filename: "Beach day.MOV" });
    // Uploads land in the holding area; the optimizer moves them to raw/ (lib/media/optimize.ts).
    expect(clip.r2Key).toBe(`ws/${a.workspaceId}/conv/${a.conversationId}/incoming/${json.mediaId}-Beach-day.MOV`);
    expect(r2.createMultipartUpload).toHaveBeenCalledWith(clip.r2Key, "video/quicktime");
  });

  it("raises the part size so there are at most 10,000 parts", () => {
    expect(planParts(10 * GB)).toEqual({ partSize: 16 * 1024 ** 2, partCount: 640 });
    expect(planParts(1)).toEqual({ partSize: 16 * 1024 ** 2, partCount: 1 });
    const huge = planParts(500 * GB);
    expect(huge.partCount).toBeLessThanOrEqual(10_000);
    expect(huge.partSize % 1024 ** 2).toBe(0);
    expect(huge.partSize * huge.partCount).toBeGreaterThanOrEqual(500 * GB);
  });

  it("accepts video types, or .mov/.mp4/.m4v by name, and refuses anything else", async () => {
    expect((await startClip(a, { filename: "clip", size: 10, contentType: "video/webm" })).status).toBe(200);
    expect((await startClip(a, { filename: "clip.m4v", size: 10, contentType: "application/octet-stream" })).status).toBe(200);
    expect((await startClip(a, { filename: "photo.jpg", size: 10, contentType: "image/jpeg" })).status).toBe(415);
    expect((await startClip(a, { filename: "notes.txt", size: 10 })).status).toBe(415);
  });

  it("refuses files over 10 GB", async () => {
    const res = await startClip(a, { filename: "huge.mov", size: 10 * GB + 1, contentType: "video/quicktime" });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("file_too_large");
    expect(r2.createMultipartUpload).not.toHaveBeenCalled();
  });

  it("refuses a clip that would go over the workspace's storage", async () => {
    await db.execute(sql`update media_objects set size_bytes = ${STORAGE_LIMIT_BYTES - 1000} where id = ${a.mediaId}`);
    const res = await startClip(a, { filename: "one-more.mov", size: 5000, contentType: "video/quicktime" });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("storage_limit");
    // Another workspace's usage is not this one's.
    state.current = b.user;
    expect((await startClip(b, { filename: "one-more.mov", size: 5000, contentType: "video/quicktime" })).status).toBe(200);
  });

  it("refuses path tricks in the filename and closed threads", async () => {
    expect((await startClip(a, { filename: "../../etc/x.mov", size: 10, contentType: "video/quicktime" })).status).toBe(400);
    await db.update(schema.conversations).set({ status: "closed" }).where(eq(schema.conversations.id, a.conversationId));
    expect((await startClip(a, { filename: "x.mov", size: 10, contentType: "video/quicktime" })).status).toBe(409);
  });

  it("answers 503 when storage is not configured", async () => {
    const { StorageNotConfiguredError } = await import("@/lib/storage/r2");
    r2.createMultipartUpload.mockRejectedValueOnce(new StorageNotConfiguredError());
    expect((await startClip(a, { filename: "x.mov", size: 10, contentType: "video/quicktime" })).status).toBe(503);
  });
});

describe("parts, complete, abort", () => {
  it("hands out part URLs for this thread's uploading clip only", async () => {
    const res = await parts(req({ partNumbers: [1] }), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }));
    expect(res.status).toBe(200);
    expect((await res.json()).urls).toHaveLength(1);
    // Beyond the clip's part count, or too many at once.
    expect((await parts(req({ partNumbers: [2] }), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }))).status).toBe(400);
    expect((await parts(req({ partNumbers: Array.from({ length: 51 }, (_, i) => i + 1) }), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }))).status).toBe(400);
  });

  it("answers 404 for a media id from another conversation", async () => {
    // Another open thread in the same workspace (a teammate's).
    const [other] = await db
      .insert(schema.conversations)
      .values({ workspaceId: a.workspaceId, startedBy: "00000000-0000-4000-8000-0000000000ee", startedVia: "app", status: "open" })
      .returning();
    const p = { id: other.id, mediaId: a.uploadingMediaId };
    expect((await parts(req({ partNumbers: [1] }), ctx(p))).status).toBe(404);
    expect((await complete(req({ parts: [{ partNumber: 1, etag: '"e"' }] }), ctx(p))).status).toBe(404);
    expect((await abort(req(), ctx(p))).status).toBe(404);
    expect((await done(req({ mediaIds: [a.mediaId] }), ctx({ id: other.id }))).status).toBe(404);
    // And another workspace's clip from one's own thread.
    expect((await parts(req({ partNumbers: [1] }), ctx({ id: a.conversationId, mediaId: b.uploadingMediaId }))).status).toBe(404);
    expect(r2.presignUploadPart).not.toHaveBeenCalled();
  });

  it("completes, checks the size, and marks the clip ready (no optimizer configured)", async () => {
    r2.headObject.mockResolvedValueOnce({ size: 2000, contentType: "video/quicktime", etag: '"x"' });
    const res = await complete(req({ parts: [{ partNumber: 1, etag: '"e1"' }] }), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }));
    expect(res.status).toBe(200);
    expect(await row(a.uploadingMediaId)).toMatchObject({ status: "ready", uploadId: null, deletedAt: null, originalSizeBytes: 2000, optimizeError: null });
    expect(r2.completeMultipartUpload).toHaveBeenCalledWith(expect.stringContaining(`ws/${a.workspaceId}/`), `alpha-upload-id`, [{ partNumber: 1, etag: '"e1"' }]);
  });

  it("marks the clip failed when the stored size is wrong", async () => {
    r2.headObject.mockResolvedValueOnce({ size: 1999, contentType: "video/quicktime", etag: '"x"' });
    const res = await complete(req({ parts: [{ partNumber: 1, etag: '"e1"' }] }), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }));
    expect(res.status).toBe(422);
    const clip = await row(a.uploadingMediaId);
    expect(clip.status).toBe("failed");
    expect(clip.deletedAt).not.toBeNull();
    expect(r2.deleteObject).toHaveBeenCalledWith(clip.r2Key);
  });

  it("needs every part, once", async () => {
    const res = await complete(req({ parts: [{ partNumber: 1, etag: "a" }, { partNumber: 1, etag: "b" }] }), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }));
    expect(res.status).toBe(400);
    expect(r2.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it("aborts an uploading clip, but not a finished one", async () => {
    expect((await abort(req(), ctx({ id: a.conversationId, mediaId: a.uploadingMediaId }))).status).toBe(200);
    expect(r2.abortMultipartUpload).toHaveBeenCalledWith(expect.any(String), "alpha-upload-id");
    expect(await row(a.uploadingMediaId)).toMatchObject({ status: "failed" });
    expect((await abort(req(), ctx({ id: a.conversationId, mediaId: a.mediaId }))).status).toBe(409);
  });
});

describe("done", () => {
  it("posts one message for the batch and hands it to the editor", async () => {
    const [second] = await db
      .insert(schema.mediaObjects)
      .values({ ...(await row(a.mediaId)), id: undefined, r2Key: `ws/${a.workspaceId}/conv/${a.conversationId}/raw/00000000-0000-4000-8000-0000000000ff-x.mov`, sizeBytes: Math.round(1.2 * GB) - 2000 })
      .returning();
    const res = await done(req({ mediaIds: [a.mediaId, second.id] }), ctx({ id: a.conversationId }));
    expect(res.status).toBe(200);
    const added = await db
      .select()
      .from(schema.conversationMessages)
      .where(and(eq(schema.conversationMessages.conversationId, a.conversationId), eq(schema.conversationMessages.direction, "out")));
    expect(added.map((m) => m.body)).toEqual(["Added 2 clips (1.2 GB)"]);
    expect(editor.handOffToEditor).toHaveBeenCalledTimes(1);
    expect(editor.handOffToEditor).toHaveBeenCalledWith(a.conversationId, added[0].id);
  });

  it("counts only ready clips, and refuses a batch with none", async () => {
    expect((await done(req({ mediaIds: [a.uploadingMediaId] }), ctx({ id: a.conversationId }))).status).toBe(400);
    const res = await done(req({ mediaIds: [a.mediaId, a.uploadingMediaId] }), ctx({ id: a.conversationId }));
    expect((await res.json()).count).toBe(1);
  });
});

describe("reading a file", () => {
  it("redirects to a short-lived signed link for the owner only", async () => {
    const res = await media(new NextRequest("http://localhost/api/media/x"), ctx({ mediaId: a.mediaId }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(`ws/${a.workspaceId}/`);
    state.current = b.user;
    expect((await media(new NextRequest("http://localhost/api/media/x"), ctx({ mediaId: a.mediaId }))).status).toBe(404);
    state.current = null;
    expect((await media(new NextRequest("http://localhost/api/media/x"), ctx({ mediaId: a.mediaId }))).status).toBe(401);
  });

  it("is 404 once deleted and 409 while uploading", async () => {
    expect((await media(new NextRequest("http://localhost/api/media/x"), ctx({ mediaId: a.uploadingMediaId }))).status).toBe(409);
    await db.update(schema.mediaObjects).set({ deletedAt: new Date() }).where(eq(schema.mediaObjects.id, a.mediaId));
    expect((await media(new NextRequest("http://localhost/api/media/x"), ctx({ mediaId: a.mediaId }))).status).toBe(404);
  });
});
