/**
 * The editor worker's signed callback, and the stuck-job sweep. In-memory database; R2 is mocked.
 */
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedEditorJob, seedWorkspace, snapshot, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
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
  headObject: vi.fn(async (): Promise<{ size: number; contentType: string | null; etag: string | null } | null> => ({ size: 4321, contentType: "video/mp4", etag: '"e"' })),
}));
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, ...r2 };
});

import { POST as callbackRoute } from "@/app/api/editor/callback/route";
import { approvePendingPreview } from "@/lib/conversations/editor";
import { FAILED_MESSAGE } from "@/lib/editor/callback";
import { recoverStuckEditorJobs, STUCK_MESSAGE } from "@/lib/editor/jobs";
import { signWorkerBody } from "@/lib/media/worker-signature";
import { buildMediaKey, buildPreviewKey } from "@/lib/storage/keys";

const SECRET = "test-editor-secret";
let db: TestDb;
let a: Seeded;
let b: Seeded;
let fetchMock: ReturnType<typeof vi.fn>;

const send = (payload: unknown, signature: string | null = signWorkerBody(SECRET, JSON.stringify(payload))) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-nekter-signature"] = signature;
  return callbackRoute(new NextRequest("http://localhost/api/editor/callback", { method: "POST", body: JSON.stringify(payload), headers }));
};
const job = async (id: string) => (await db.select().from(schema.editorJobs).where(eq(schema.editorJobs.id, id)))[0];
const previews = async () => db.select().from(schema.mediaObjects).where(and(eq(schema.mediaObjects.conversationId, a.conversationId), eq(schema.mediaObjects.kind, "preview")));
const outMessages = async () =>
  db.select().from(schema.conversationMessages).where(and(eq(schema.conversationMessages.conversationId, a.conversationId), eq(schema.conversationMessages.direction, "out")));

async function runningJob(startedAt = new Date()): Promise<string> {
  const [row] = await db
    .insert(schema.editorJobs)
    .values({ workspaceId: a.workspaceId, conversationId: a.conversationId, brandId: a.brandId, kind: "first_cut", status: "running", request: "make a reel", model: "claude-opus-5-5", startedAt })
    .returning();
  return row.id;
}

const key = (jobId: string, name = "reel-15.mp4") => buildPreviewKey({ workspaceId: a.workspaceId, conversationId: a.conversationId, jobId, filename: name });
const cut = (jobId: string, over: Record<string, unknown> = {}) => ({
  id: "reel-15",
  title: "The build, fast",
  seconds: 15.2,
  mode: "music",
  preview: { key: key(jobId) },
  edl: [{ mediaId: a.mediaId, in: 1.5, dur: 3, speed: 1, cropX: null }],
  hookOptions: ["Hook one", "Hook two"],
  caption: "A caption",
  script: null,
  coverAt: 2,
  ...over,
});
const usage = { inputTokens: 120000, outputTokens: 9000, cacheReadTokens: 80000, costUsd: 1.42, turns: 31, seconds: 610 };
const result = (jobId: string, over: Record<string, unknown> = {}) => ({
  jobId,
  ok: true,
  error: null,
  manifest: { cuts: [cut(jobId)] },
  reply: "Here's a 15-second cut.",
  question: null,
  usage,
  ...over,
});

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Bravo", "00000000-0000-4000-8000-00000000000b");
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: "SMx" }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.MODAL_EDITOR_SECRET = SECRET;
  process.env.APP_URL = "https://app.test";
});

afterEach(() => {
  for (const k of ["MODAL_EDITOR_SECRET", "APP_URL", "SALESMSG_API_TOKEN", "SALESMSG_TEAM_ID"]) delete process.env[k];
});

describe("POST /api/editor/callback", () => {
  it("refuses a missing or wrong signature, or any call while the secret is unset, changing nothing", async () => {
    const id = await runningJob();
    const before = await snapshot(db);
    expect((await send(result(id), null)).status).toBe(403);
    expect((await send(result(id), signWorkerBody("wrong-secret", JSON.stringify(result(id))))).status).toBe(403);
    delete process.env.MODAL_EDITOR_SECRET;
    expect((await send(result(id), signWorkerBody(SECRET, JSON.stringify(result(id))))).status).toBe(403);
    expect(await snapshot(db)).toEqual(before);
  });

  it("answers 400 for a malformed body and 404 for a job nobody started", async () => {
    expect((await send({ jobId: "nope", ok: true })).status).toBe(400);
    expect((await send(result("99999999-9999-4999-8999-999999999999"))).status).toBe(404);
  });

  it("accepts what the worker accepts: a long take at 300x and a long title", async () => {
    const id = await runningJob();
    const fast = cut(id, { title: "T".repeat(500), edl: [{ mediaId: a.mediaId, in: 0, dur: 30, speed: 300, cropX: null }] });
    expect((await send(result(id, { manifest: { cuts: [fast] } }))).status).toBe(200);
    expect((await job(id)).status).toBe("done");
  });

  it("a result in the wrong shape fails its job at once, with the field that failed", async () => {
    const id = await runningJob();
    const bad = cut(id, { edl: [{ mediaId: a.mediaId, in: 0, dur: 3, speed: 900, cropX: null }] });
    expect((await send(result(id, { manifest: { cuts: [bad] } }))).status).toBe(400);
    const j = await job(id);
    expect(j.status).toBe("failed");
    expect(j.error).toContain("manifest.cuts.0.edl.0.speed");
  });

  it("stores the cuts: preview rows from storage, the manifest with their ids, the cost, and one reply", async () => {
    const id = await runningJob();
    const res = await send(result(id, { question: "Want a 30-second one too?" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: true, cuts: 1 });

    const [p] = await previews();
    expect(p).toMatchObject({ kind: "preview", status: "ready", r2Key: key(id), filename: "reel-15.mp4", sizeBytes: 4321, brandId: a.brandId, workspaceId: a.workspaceId, contentType: "video/mp4" });
    const j = await job(id);
    expect(j.status).toBe("done");
    expect(j.costUsd).toBe("1.420000");
    expect(j.usage).toEqual(usage);
    expect(j.finishedAt).toBeInstanceOf(Date);
    expect(j.manifest?.cuts[0].preview).toEqual({ key: key(id), mediaId: p.id });

    const out = await outMessages();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ editorJobId: id, channel: "sms", body: "Here's a 15-second cut.\n\nWant a 30-second one too?" });
  });

  it("texts the cut with its watch link and what to do next, when the thread's last message came by text", async () => {
    process.env.SALESMSG_API_TOKEN = "t";
    process.env.SALESMSG_TEAM_ID = "4242";
    const id = await runningJob();
    await send(result(id));
    const salesmsg = fetchMock.mock.calls.find(([url]) => String(url).includes("api.salesmessage.com"));
    expect(salesmsg).toBeDefined();
    const body = new URL(String(salesmsg![0])).searchParams;
    expect(body.get("number")).toBe(a.phone);
    expect(body.get("team_id")).toBe("4242");
    expect(body.get("message")).toMatch(
      /^Here's a 15-second cut\.\n\nWatch, download or approve it: https:\/\/app\.test\/w\/[A-Za-z0-9_-]{43}\nOr reply YES to approve, or tell me what to change\.$/,
    );
  });

  it("applies a job once: a repeated callback is acknowledged and ignored", async () => {
    const id = await runningJob();
    expect((await send(result(id))).status).toBe(200);
    const after = await snapshot(db);
    const again = await send(result(id, { reply: "different" }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ applied: false });
    expect(await snapshot(db)).toEqual(after);
  });

  it.each([
    ["under another job's prefix", () => ({ preview: { key: key("88888888-8888-4888-8888-888888888888") } }), "outside this job"],
    ["a raw clip's key", () => ({ preview: { key: buildMediaKey({ workspaceId: a.workspaceId, conversationId: a.conversationId, filename: "x.mp4" }) } }), "outside this job"],
    ["another workspace's prefix", (id: string) => ({ preview: { key: buildPreviewKey({ workspaceId: b.workspaceId, conversationId: b.conversationId, jobId: id, filename: "reel-15.mp4" }) } }), "outside this job"],
    ["a path trick", (id: string) => ({ preview: { key: `${key(id).replace("reel-15.mp4", "")}../../raw/x.mp4` } }), "outside this job"],
    ["a clip of another workspace in the edit list", () => ({ edl: [{ mediaId: b.mediaId, in: 0, dur: 1, speed: 1, cropX: null }] }), "not in this conversation"],
    ["an unknown clip in the edit list", () => ({ edl: [{ mediaId: "77777777-7777-4777-8777-777777777777", in: 0, dur: 1, speed: 1, cropX: null }] }), "not in this conversation"],
  ])("rejects a manifest with %s: the job fails, nothing is stored, the thread hears plainly", async (_label, over, reason) => {
    const id = await runningJob();
    const res = await send(result(id, { manifest: { cuts: [cut(id, over(id))] } }));
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain(reason);
    expect(await previews()).toHaveLength(0);
    const j = await job(id);
    expect(j.status).toBe("failed");
    expect(j.costUsd).toBe("1.420000"); // the real cost is recorded even when the result is refused
    expect((await outMessages()).map((m) => m.body)).toEqual([FAILED_MESSAGE]);
  });

  it("rejects a preview that never reached storage", async () => {
    r2.headObject.mockResolvedValueOnce(null);
    const id = await runningJob();
    expect((await send(result(id))).status).toBe(422);
    expect((await job(id)).status).toBe("failed");
    expect(await previews()).toHaveLength(0);
  });

  it("a failed job posts a plain error and records its usage", async () => {
    const id = await runningJob();
    expect((await send(result(id, { ok: false, error: "ffmpeg exploded", manifest: null, reply: "" }))).status).toBe(200);
    const j = await job(id);
    expect(j).toMatchObject({ status: "failed", error: "ffmpeg exploded", costUsd: "1.420000" });
    expect((await outMessages()).map((m) => m.body)).toEqual([FAILED_MESSAGE]);
  });

  it("ignores a callback for a job that is no longer running", async () => {
    const id = await runningJob();
    await db.update(schema.editorJobs).set({ status: "failed" }).where(eq(schema.editorJobs.id, id));
    const before = await snapshot(db);
    expect(await (await send(result(id))).json()).toMatchObject({ applied: false });
    expect(await snapshot(db)).toEqual(before);
  });

  it("a question with no cuts finishes the job with nothing to approve", async () => {
    const id = await runningJob();
    expect((await send(result(id, { manifest: null, reply: "", question: "Keep the voice-over or swap to music?" }))).status).toBe(200);
    expect(await job(id)).toMatchObject({ status: "done", manifest: null });
    expect((await outMessages()).map((m) => m.body)).toEqual(["Keep the voice-over or swap to music?"]);
    expect(await approvePendingPreview(a.conversationId)).toEqual({ approved: false, reason: "nothing pending" });
  });

  it("a revision may keep the previous job's preview for an unchanged cut, reusing its row", async () => {
    const prev = await seedEditorJob(db, a, "Alpha");
    const [old] = await db.select().from(schema.mediaObjects).where(eq(schema.mediaObjects.id, prev.previewMediaId));
    const id = await runningJob();
    const manifest = { cuts: [cut(id, { id: "cut-1", preview: { key: old.r2Key } }), cut(id, { id: "reel-30", preview: { key: key(id, "reel-30.mp4") } })] };
    expect((await send(result(id, { manifest }))).status).toBe(200);
    const j = await job(id);
    expect(j.manifest?.cuts.map((c) => c.preview.mediaId)[0]).toBe(prev.previewMediaId);
    expect(await previews()).toHaveLength(2); // the old one plus one new
  });
});

describe("music on a cut", () => {
  const addTrack = async (title: string, workspaceId: string | null = null) =>
    (await db.insert(schema.musicTracks).values({ title, r2Key: `music/library/${title}.mp3`, seconds: 120, source: "test", workspaceId }).returning())[0].id;
  const withMusic = (jobId: string, trackId: string, over: Record<string, unknown> = {}) =>
    cut(jobId, { music: { trackId, start: 41.25, silent: { key: key(jobId, "reel-15-nomusic.mp4") } }, ...over });

  it("stores the track (title, start) and the copy without music as its own preview row", async () => {
    const trackId = await addTrack("Summer Days");
    const id = await runningJob();
    expect((await send(result(id, { manifest: { cuts: [withMusic(id, trackId)] } }))).status).toBe(200);
    const j = await job(id);
    expect(j.status).toBe("done");
    const music = j.manifest?.cuts[0].music;
    expect(music).toMatchObject({ trackId, title: "Summer Days", start: 41.25, silent: { key: key(id, "reel-15-nomusic.mp4") } });
    const rows = await previews();
    expect(rows.map((r) => r.r2Key).sort()).toEqual([key(id), key(id, "reel-15-nomusic.mp4")].sort());
    expect(rows.find((r) => r.r2Key === key(id, "reel-15-nomusic.mp4"))?.id).toBe(music?.silent.mediaId);
  });

  it("accepts the workspace's own track, and a silent cut (music null or absent)", async () => {
    const own = await addTrack("Alpha Song", a.workspaceId);
    const id = await runningJob();
    const cuts = [withMusic(id, own), cut(id, { id: "reel-30", preview: { key: key(id, "reel-30.mp4") }, music: null })];
    expect((await send(result(id, { manifest: { cuts } }))).status).toBe(200);
    const j = await job(id);
    expect(j.manifest?.cuts.map((c) => c.music?.title ?? null)).toEqual(["Alpha Song", null]);
  });

  it("accepts the brand's own track, and rejects another brand's, even in the same workspace", async () => {
    const id = await runningJob();
    expect((await send(result(id, { manifest: { cuts: [withMusic(id, a.musicTrackId)] } }))).status).toBe(200);
    expect((await job(id)).manifest?.cuts[0].music?.title).toBe("Alpha track");
    const [sibling] = await db.insert(schema.brands).values({ workspaceId: a.workspaceId, name: "Alpha sibling", slug: "alpha-sibling", status: "active" }).returning();
    const [theirs] = await db
      .insert(schema.musicTracks)
      .values({ title: "Sibling Song", r2Key: "music/library/sibling.mp3", seconds: 120, source: "test", workspaceId: a.workspaceId, brandId: sibling.id })
      .returning();
    const id2 = await runningJob();
    expect((await send(result(id2, { manifest: { cuts: [withMusic(id2, theirs.id)] } }))).status).toBe(422);
    const id3 = await runningJob();
    expect((await send(result(id3, { manifest: { cuts: [withMusic(id3, b.musicTrackId)] } }))).status).toBe(422);
  });

  it("rejects a track from another workspace, changing nothing but failing the job", async () => {
    const theirs = await addTrack("Bravo Song", b.workspaceId);
    const id = await runningJob();
    const res = await send(result(id, { manifest: { cuts: [withMusic(id, theirs)] } }));
    expect(res.status).toBe(422);
    const j = await job(id);
    expect(j.status).toBe("failed");
    expect(j.error).toContain("music that is not in this workspace's library");
    expect(await previews()).toHaveLength(0);
  });

  it("rejects a track that does not exist, and a silent copy outside this job's storage", async () => {
    const id = await runningJob();
    expect((await send(result(id, { manifest: { cuts: [withMusic(id, "99999999-9999-4999-8999-999999999999")] } }))).status).toBe(422);
    const trackId = await addTrack("Summer Days");
    const id2 = await runningJob();
    const elsewhere = buildPreviewKey({ workspaceId: b.workspaceId, conversationId: b.conversationId, jobId: id2, filename: "x.mp4" });
    const bad = withMusic(id2, trackId, { music: { trackId, start: 1, silent: { key: elsewhere } } });
    expect((await send(result(id2, { manifest: { cuts: [bad] } }))).status).toBe(422);
    expect((await job(id2)).error).toContain("outside this job's storage");
  });

  it("refuses music outside the worker's limits (same as contract.py): a start past an hour, a missing silent copy", async () => {
    const trackId = await addTrack("Summer Days");
    const id = await runningJob();
    expect((await send(result(id, { manifest: { cuts: [withMusic(id, trackId, { music: { trackId, start: 3601, silent: { key: key(id, "s.mp4") } } })] } }))).status).toBe(400);
    const id2 = await runningJob();
    expect((await send(result(id2, { manifest: { cuts: [withMusic(id2, trackId, { music: { trackId, start: 3 } })] } }))).status).toBe(400);
  });

  it("a revision keeps an unchanged cut's music and its copy without music, reusing both rows", async () => {
    const trackId = await addTrack("Summer Days");
    const first = await runningJob(new Date(Date.now() - 60_000));
    await db.update(schema.editorJobs).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(schema.editorJobs.id, first));
    expect((await send(result(first, { manifest: { cuts: [withMusic(first, trackId)] } }))).status).toBe(200);
    const kept = (await job(first)).manifest!.cuts[0];
    const id = await runningJob();
    const again = cut(id, { preview: { key: kept.preview.key }, music: { trackId, start: 41.25, silent: { key: kept.music!.silent.key } } });
    expect((await send(result(id, { manifest: { cuts: [again] } }))).status).toBe(200);
    const j = await job(id);
    expect(j.status).toBe("done");
    expect(j.manifest?.cuts[0].music?.silent.mediaId).toBe(kept.music!.silent.mediaId);
    expect(await previews()).toHaveLength(2);
  });
});

describe("stuck jobs", () => {
  it("fails jobs with no result within 35 minutes and says so in their thread", async () => {
    const now = new Date();
    const stuck = await runningJob(new Date(now.getTime() - 40 * 60 * 1000));
    expect(await recoverStuckEditorJobs(now)).toBe(1);
    expect((await job(stuck)).status).toBe("failed");
    expect((await outMessages()).map((m) => m.body)).toEqual([STUCK_MESSAGE]);
    expect((await send(result(stuck))).status).toBe(200); // a late answer is ignored
    expect(await previews()).toHaveLength(0);
  });

  it("leaves a job that is still within its time alone", async () => {
    const fresh = await runningJob(new Date(Date.now() - 10 * 60 * 1000));
    expect(await recoverStuckEditorJobs()).toBe(0);
    expect((await job(fresh)).status).toBe("running");
  });
});

describe("a track from Epidemic Sound", () => {
  const RECORDING = "bc654f2f-4b61-4278-8f98-2cfb5c3aad7b";
  const trackKey = (jobId: string) => key(jobId, "es-summer-knot-bc654f2f.mp3");
  const withNewTrack = (jobId: string, over: Record<string, unknown> = {}, cutOver: Record<string, unknown> = {}) =>
    cut(jobId, {
      music: {
        newTrack: { key: trackKey(jobId), recordingId: RECORDING, title: "Summer Knot", seconds: 192.5, bpm: 105, ...over },
        start: 12.5,
        silent: { key: key(jobId, `${(cutOver.id as string) ?? "reel-15"}-nomusic.mp4`) },
      },
      ...cutOver,
    });
  const tracks = async (brandId: string) => db.select().from(schema.musicTracks).where(and(eq(schema.musicTracks.brandId, brandId), eq(schema.musicTracks.source, `epidemic-sound:${RECORDING}`)));

  it("joins the brand's library once, and the cuts name it like any other track", async () => {
    const id = await runningJob();
    const cuts = [withNewTrack(id), withNewTrack(id, {}, { id: "reel-30", preview: { key: key(id, "reel-30.mp4") } })];
    expect((await send(result(id, { manifest: { cuts } }))).status).toBe(200);
    const rows = await tracks(a.brandId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Summer Knot", seconds: 192.5, bpm: 105, r2Key: trackKey(id), workspaceId: a.workspaceId, active: true });
    const j = await job(id);
    expect(j.status).toBe("done");
    expect(j.manifest?.cuts.map((c) => c.music)).toMatchObject([
      { trackId: rows[0].id, title: "Summer Knot", start: 12.5 },
      { trackId: rows[0].id, title: "Summer Knot", start: 12.5 },
    ]);
    // The audio file is not a preview: only the cuts and their copies without music are.
    expect((await previews()).map((r) => r.r2Key)).not.toContain(trackKey(id));
    expect(await tracks(b.brandId)).toHaveLength(0);
  });

  it("reuses the brand's row when a later job brings in the same recording", async () => {
    const first = await runningJob();
    expect((await send(result(first, { manifest: { cuts: [withNewTrack(first)] } }))).status).toBe(200);
    await db.update(schema.editorJobs).set({ status: "approved" }).where(eq(schema.editorJobs.id, first));
    const second = await runningJob();
    expect((await send(result(second, { manifest: { cuts: [withNewTrack(second)] } }))).status).toBe(200);
    const rows = await tracks(a.brandId);
    expect(rows).toHaveLength(1);
    expect(rows[0].r2Key).toBe(trackKey(first));
    expect((await job(second)).manifest?.cuts[0].music?.trackId).toBe(rows[0].id);
  });

  it("refuses a file outside the job's own storage, one that is not an mp3, or one that was never uploaded", async () => {
    const id = await runningJob();
    const elsewhere = buildPreviewKey({ workspaceId: b.workspaceId, conversationId: b.conversationId, jobId: id, filename: "es-x.mp3" });
    expect((await send(result(id, { manifest: { cuts: [withNewTrack(id, { key: elsewhere })] } }))).status).toBe(422);
    const id2 = await runningJob();
    expect((await send(result(id2, { manifest: { cuts: [withNewTrack(id2, { key: key(id2, "es-x.mp4") })] } }))).status).toBe(422);
    const id3 = await runningJob();
    r2.headObject.mockImplementation(async (k?: string) => (String(k).endsWith(".mp3") ? null : { size: 4321, contentType: "video/mp4", etag: '"e"' }));
    try {
      expect((await send(result(id3, { manifest: { cuts: [withNewTrack(id3)] } }))).status).toBe(422);
    } finally {
      r2.headObject.mockImplementation(async () => ({ size: 4321, contentType: "video/mp4", etag: '"e"' }));
    }
    expect(await tracks(a.brandId)).toHaveLength(0);
    expect((await job(id3)).status).toBe("failed");
  });

  it("refuses music that names both a library track and a new one, or neither", async () => {
    const id = await runningJob();
    const both = withNewTrack(id) as unknown as { music: Record<string, unknown> };
    both.music.trackId = "99999999-9999-4999-8999-999999999999";
    expect((await send(result(id, { manifest: { cuts: [both] } }))).status).toBe(400);
    const id2 = await runningJob();
    expect((await send(result(id2, { manifest: { cuts: [cut(id2, { music: { start: 1, silent: { key: key(id2, "reel-15-nomusic.mp4") } } })] } }))).status).toBe(400);
  });
});
