/**
 * A cut finished on the phone takes the place of the editor's preview: the link to send it, the
 * checks before it is accepted, and what the thread plays afterwards.
 * In-memory database; R2 is mocked.
 */
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedEditorJob, seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
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
  presignPut: vi.fn((key: string, expires?: number) => `https://r2.test/put/${key}?exp=${expires}`),
  headObject: vi.fn(async (): Promise<{ size: number; contentType: string; etag: string } | null> => ({ size: 5000, contentType: "video/mp4", etag: '"e"' })),
}));
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, ...r2 };
});

import { PATCH as complete, POST as start } from "@/app/api/conversations/[id]/final/route";
import { GET as threadRoute } from "@/app/api/conversations/[id]/route";
import type { EditorManifest } from "@/lib/editor/manifest";

let db: TestDb;
let a: Seeded;
let jobId: string;
let previewMediaId: string;

const ctx = () => ({ params: Promise.resolve({ id: a.conversationId }) });
const req = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/x", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const shots = () => [
  { mediaId: a.mediaId, in: 1, dur: 2, speed: 1, cropX: null },
  { mediaId: a.mediaId, in: 4, dur: 1.5, speed: 1, cropX: 0.5 },
];
const finished = (over: Record<string, unknown> = {}) => ({ jobId, cutKey: "cut-1", size: 5000, seconds: 3.5, shots: shots(), ...over });
const manifest = async () => (await db.select().from(schema.editorJobs).where(eq(schema.editorJobs.id, jobId)))[0].manifest as EditorManifest;

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  ({ editorJobId: jobId, previewMediaId } = await seedEditorJob(db, a, "Alpha"));
  state.current = a.user;
  vi.clearAllMocks();
});

describe("a cut finished on the phone", () => {
  it("gives a link to send the file to, under the job's own storage", async () => {
    const res = await start(req("POST", { jobId, cutKey: "cut-1", size: 5000 }), ctx());
    expect(res.status).toBe(200);
    const key = `ws/${a.workspaceId}/conv/${a.conversationId}/preview/${jobId}/phone-cut-1.mp4`;
    expect(await res.json()).toEqual({ uploadUrl: `https://r2.test/put/${key}?exp=3600` });
  });

  it("points the cut at the phone's file and keeps its edit list", async () => {
    const res = await complete(req("PATCH", finished()), ctx());
    expect(res.status).toBe(200);
    const { previewId } = await res.json();
    expect(previewId).not.toBe(previewMediaId);
    const [cut] = (await manifest()).cuts;
    expect(cut.preview).toEqual({ key: `ws/${a.workspaceId}/conv/${a.conversationId}/preview/${jobId}/phone-cut-1.mp4`, mediaId: previewId });
    expect(cut.seconds).toBe(3.5);
    expect(cut.edl).toEqual(shots());
    // The thread now plays the phone's version.
    const thread = await (await threadRoute(new NextRequest("http://localhost/api/x"), ctx())).json();
    const shown = thread.messages.find((m: { editor: unknown }) => m.editor).editor.cuts[0];
    expect(shown).toMatchObject({ previewId, seconds: 3.5 });
    expect(shown.shots).toHaveLength(2);
  });

  it("sending it again reuses the same file record", async () => {
    const first = await (await complete(req("PATCH", finished()), ctx())).json();
    r2.headObject.mockResolvedValueOnce({ size: 6000, contentType: "video/mp4", etag: '"f"' });
    const second = await (await complete(req("PATCH", finished({ size: 6000 })), ctx())).json();
    expect(second.previewId).toBe(first.previewId);
    const [row] = await db.select().from(schema.mediaObjects).where(eq(schema.mediaObjects.id, first.previewId));
    expect(row.sizeBytes).toBe(6000);
  });

  it("refuses a file that did not arrive complete, and changes nothing", async () => {
    const before = await manifest();
    r2.headObject.mockResolvedValueOnce({ size: 4000, contentType: "video/mp4", etag: '"e"' });
    expect((await complete(req("PATCH", finished()), ctx())).status).toBe(422);
    r2.headObject.mockResolvedValueOnce(null);
    expect((await complete(req("PATCH", finished()), ctx())).status).toBe(422);
    expect(await manifest()).toEqual(before);
  });

  it("refuses shots from a clip that is not in the chat, an unknown cut, and a job that is not the newest", async () => {
    const stranger = "99999999-9999-4999-8999-999999999999";
    expect((await complete(req("PATCH", finished({ shots: [{ mediaId: stranger, in: 0, dur: 1, speed: 1, cropX: null }] })), ctx())).status).toBe(400);
    expect((await start(req("POST", { jobId, cutKey: "no-such-cut", size: 5000 }), ctx())).status).toBe(404);
    expect((await start(req("POST", { jobId: stranger, cutKey: "cut-1", size: 5000 }), ctx())).status).toBe(409);
    expect(r2.presignPut).not.toHaveBeenCalled();
  });

  it("refuses once the cut is on the calendar", async () => {
    const [brief] = await db.insert(schema.briefs).values({ brandId: a.brandId, channel: "instagram", format: "reel", title: "t", status: "approved" }).returning();
    const [draft] = await db
      .insert(schema.drafts)
      .values({ briefId: brief.id, brandId: a.brandId, channel: "instagram", format: "reel", caption: "c", status: "scheduled", metaJson: { editorJobId: jobId, cutId: "cut-1" } })
      .returning();
    await db.insert(schema.posts).values({ draftId: draft.id, brandId: a.brandId, channel: "instagram", status: "queued", scheduledFor: new Date(Date.now() + 3600_000) });
    const res = await start(req("POST", { jobId, cutKey: "cut-1", size: 5000 }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_scheduled");
  });

  it("refuses in a closed chat", async () => {
    await db.execute(sql`update conversations set status = 'closed' where id = ${a.conversationId}`);
    expect((await start(req("POST", { jobId, cutKey: "cut-1", size: 5000 }), ctx())).status).toBe(409);
  });
});
