/**
 * Starting editor jobs (the seam), the worker's upload links, approving, and what the thread view
 * gets. In-memory database; R2 and the worker endpoint are mocked.
 */
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedEditorJob, seedWorkspace, snapshot, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
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
  presignGet: vi.fn((key: string, expires?: number) => `https://r2.test/get/${key}?exp=${expires}`),
  presignPut: vi.fn((key: string, expires?: number) => `https://r2.test/put/${key}?exp=${expires}`),
}));
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, ...r2 };
});

import { GET as threadRoute } from "@/app/api/conversations/[id]/route";
import { POST as approveRoute } from "@/app/api/conversations/[id]/approve/route";
import { POST as uploadsRoute } from "@/app/api/editor/uploads/route";
import { handOffToEditor } from "@/lib/conversations/editor";
import { handleInbound } from "@/lib/conversations/handle";
import { EDITOR_NOT_CONNECTED } from "@/lib/conversations/router";
import { REPLIES } from "@/lib/editor/submit";
import { EDITABLE_SKILL_PATHS } from "@/lib/editor/skill-files";
import { SKILL_DEFAULTS } from "@/lib/editor/skill-defaults.generated";

const SECRET = "test-editor-secret";
const WORKER = "https://nekter--editor-submit.modal.run";
let db: TestDb;
let a: Seeded;
let b: Seeded;
let fetchMock: ReturnType<typeof vi.fn>;

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const jobs = async (conversationId = a.conversationId) => db.select().from(schema.editorJobs).where(eq(schema.editorJobs.conversationId, conversationId));
const say = async (body: string, who = a) => {
  const [m] = await db.insert(schema.conversationMessages).values({ conversationId: who.conversationId, direction: "in", channel: "app", body, authorUserId: who.user.userId }).returning();
  return handOffToEditor(who.conversationId, m.id, "http://localhost");
};
const sentJob = () => JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
const uploads = (job: string | null, body: unknown, auth: string | null = `Bearer ${SECRET}`) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== null) headers.authorization = auth;
  return uploadsRoute(new NextRequest(`http://localhost/api/editor/uploads${job ? `?job=${job}` : ""}`, { method: "POST", body: JSON.stringify(body), headers }));
};
const runningJob = async (status: "running" | "done" = "running") =>
  (
    await db
      .insert(schema.editorJobs)
      .values({ workspaceId: a.workspaceId, conversationId: a.conversationId, brandId: a.brandId, kind: "first_cut", status, model: "claude-opus-5-5", startedAt: new Date() })
      .returning()
  )[0].id;

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Bravo", "00000000-0000-4000-8000-00000000000b");
  state.current = a.user;
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.MODAL_EDITOR_URL = WORKER;
  process.env.MODAL_EDITOR_SECRET = SECRET;
  process.env.APP_URL = "https://app.test";
});

afterEach(() => {
  for (const k of ["MODAL_EDITOR_URL", "MODAL_EDITOR_SECRET", "APP_URL"]) delete process.env[k];
});

describe("handOffToEditor", () => {
  it("sends a first cut: presigned clips, the workspace's own key, upload and callback addresses; the job is running", async () => {
    const handoff = await say("30 second reel, upbeat");
    expect(handoff).toEqual({ queued: true, reply: REPLIES.firstCut });
    const [job] = await jobs();
    expect(job).toMatchObject({ status: "running", kind: "first_cut", request: "30 second reel, upbeat", model: "claude-opus-5-5", brandId: a.brandId });
    expect(job.startedAt).toBeInstanceOf(Date);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WORKER);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    const sent = sentJob();
    expect(Object.keys(sent).sort()).toEqual(
      ["anthropicApiKey", "brand", "callbackUrl", "clips", "instructions", "jobId", "kind", "model", "music", "previous", "request", "skillFiles", "uploads", "videoKind"].sort(),
    );
    expect(sent).toMatchObject({
      jobId: job.id,
      kind: "first_cut",
      videoKind: "reel",
      brand: { name: "Alpha brand" },
      instructions: "",
      previous: null,
      anthropicApiKey: "Alpha-anthropic-key",
      model: "claude-opus-5-5",
      uploads: { url: `https://app.test/api/editor/uploads?job=${job.id}` },
      callbackUrl: "https://app.test/api/editor/callback",
    });
    expect(sent.brand.voice).toContain("Alpha voice");
    expect(sent.clips).toEqual([{ mediaId: a.mediaId, filename: "Alpha clip.mov", url: expect.stringContaining("exp=7200") }]);
  });

  const track = (title: string, over: Partial<typeof schema.musicTracks.$inferInsert> = {}) => ({
    title,
    r2Key: `music/library/${title.toLowerCase().replace(/\s+/g, "-")}.mp3`,
    seconds: 120,
    source: "test",
    ...over,
  });

  it("sends only the brand's own active tracks: never the platform's, a legacy workspace track or another brand's", async () => {
    const own = { workspaceId: a.workspaceId, brandId: a.brandId };
    const [sibling] = await db.insert(schema.brands).values({ workspaceId: a.workspaceId, name: "Alpha sibling", slug: "alpha-sibling", status: "active" }).returning();
    await db.insert(schema.musicTracks).values([
      track("Brand Song", { ...own, bpm: 124, firstBeat: 0.2, beatStrength: 4, loudestFrom: 40 }),
      track("Switched Off", { ...own, active: false }),
      track("Odd Tempo", { ...own, bpm: 9000 }),
      track("Too Long", { ...own, seconds: 7200 }),
      track("Platform Song"),
      track("Alpha Legacy", { workspaceId: a.workspaceId }),
      track("Sibling Song", { workspaceId: a.workspaceId, brandId: sibling.id }),
      track("Bravo Song", { workspaceId: b.workspaceId, brandId: b.brandId }),
    ]);
    await say("make a reel");
    const sent = sentJob();
    expect(sent.music.map((t: { title: string }) => t.title).sort()).toEqual(["Alpha track", "Brand Song", "Odd Tempo"]);
    expect(sent.music.find((t: { title: string }) => t.title === "Brand Song")).toMatchObject({
      seconds: 120, bpm: 124, firstBeat: 0.2, beatStrength: 4, loudestFrom: 40, url: expect.stringContaining("music/library/brand-song.mp3?exp=7200"),
    });
    // Outside the worker's limits: sent without the odd value rather than refusing the whole job.
    expect(sent.music.find((t: { title: string }) => t.title === "Odd Tempo").bpm).toBeNull();
  });

  it("a brand with no library of its own gets a copy of the platform library on its first job", async () => {
    await db.delete(schema.musicTracks).where(eq(schema.musicTracks.brandId, a.brandId));
    await db.insert(schema.musicTracks).values([track("Platform Song", { bpm: 124 }), track("Platform Off", { active: false }), track("Bravo Legacy", { workspaceId: b.workspaceId })]);
    await say("make a reel");
    const sent = sentJob();
    expect(sent.music.map((t: { title: string }) => t.title)).toEqual(["Platform Song"]);
    const copies = await db.select().from(schema.musicTracks).where(eq(schema.musicTracks.brandId, a.brandId));
    expect(copies.map((t) => [t.title, t.active, t.workspaceId]).sort()).toEqual([["Platform Off", false, a.workspaceId], ["Platform Song", true, a.workspaceId]]);
    expect(sent.music[0].id).toBe(copies.find((t) => t.title === "Platform Song")?.id);
  });

  it("sends the current version of every editable skill file: the newest save, else the repo copy", async () => {
    await db.insert(schema.editorSkillVersions).values([
      { path: "hooks.md", content: "# older hooks", createdBy: a.user.userId, createdAt: new Date("2026-01-01T00:00:00Z") },
      { path: "hooks.md", content: "# newest hooks", createdBy: a.user.userId, createdAt: new Date("2026-02-01T00:00:00Z") },
    ]);
    await say("make a reel");
    const sent = sentJob();
    expect(Object.keys(sent.skillFiles).sort()).toEqual([...EDITABLE_SKILL_PATHS].sort());
    expect(sent.skillFiles["hooks.md"]).toBe("# newest hooks");
    expect(sent.skillFiles["SKILL.md"]).toBe(SKILL_DEFAULTS["SKILL.md"]);
    expect(sent.skillFiles["profiles/build.md"]).toBe(SKILL_DEFAULTS["profiles/build.md"]);
  });

  it("sends a revision with the latest finished job's manifest", async () => {
    const prev = await seedEditorJob(db, a, "Alpha");
    expect((await say("make it shorter")).reply).toBe(REPLIES.revision);
    const sent = sentJob();
    expect(sent.kind).toBe("revision");
    expect(sent.previous.manifest.cuts[0].preview.mediaId).toBe(prev.previewMediaId);
  });

  it("sends a revision what the person asked earlier in the conversation, oldest first, without clip notices", async () => {
    await seedEditorJob(db, a, "Alpha");
    const earlier = (body: string, minutesAgo: number) =>
      db.insert(schema.conversationMessages).values({ conversationId: a.conversationId, direction: "in", channel: "app", body, createdAt: new Date(Date.now() - minutesAgo * 60_000) });
    await earlier("open with him talking", 30);
    await earlier("Added 3 clips (944 MB)", 25);
    await earlier("don't make so many choppy cuts", 20);
    await db.insert(schema.conversationMessages).values({ conversationId: a.conversationId, direction: "out", channel: "app", body: "Here is the cut", createdAt: new Date(Date.now() - 15 * 60_000) });
    await say("make it 30 seconds");
    const sent = sentJob();
    expect(sent.request).toBe("make it 30 seconds");
    // "Alpha message" is the seeded thread's own first message.
    expect(sent.history).toEqual(["open with him talking", "don't make so many choppy cuts", "Alpha message"]);
  });

  it("asks for clips first when the thread has none ready", async () => {
    await db.update(schema.mediaObjects).set({ status: "uploading" }).where(eq(schema.mediaObjects.conversationId, a.conversationId));
    expect(await say("make a reel")).toMatchObject({ queued: false, reply: REPLIES.needClips });
    expect(await jobs()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing while the thread has no kind yet (the router asks)", async () => {
    await db.execute(sql`update conversations set kind = null where id = ${a.conversationId}`);
    expect(await say("hello")).toMatchObject({ queued: false });
    expect((await say("hello")).reply).toBeUndefined();
    expect(await jobs()).toHaveLength(0);
  });

  it("says it is still working while a job is running", async () => {
    await runningJob();
    expect(await say("and add music")).toMatchObject({ queued: false, reply: REPLIES.busy });
    expect(await jobs()).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("points to Settings > Connections without an Anthropic key", async () => {
    await db.delete(schema.workspaceCredentials).where(eq(schema.workspaceCredentials.workspaceId, a.workspaceId));
    const handoff = await say("make a reel");
    expect(handoff.reply).toContain("Settings > Connections");
    expect(await jobs()).toHaveLength(0);
  });

  it("fails the job and says so plainly when the worker refuses or is not configured", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
    expect(await say("make a reel")).toMatchObject({ queued: false, reply: REPLIES.refused });
    expect((await jobs())[0]).toMatchObject({ status: "failed", error: expect.stringContaining("HTTP 500") });

    delete process.env.MODAL_EDITOR_URL;
    expect(await say("try again")).toMatchObject({ queued: false, reply: EDITOR_NOT_CONNECTED });
    expect((await jobs()).map((j) => j.status)).toEqual(["failed", "failed"]);
  });

  it("by text: the reply goes back on the text channel", async () => {
    const result = await handleInbound({ workspaceId: a.workspaceId, userId: a.user.userId, channel: "sms", body: "make it punchy", providerMessageId: "SMedit1" });
    expect(result.reply).toBe(REPLIES.firstCut);
    const [last] = await db
      .select()
      .from(schema.conversationMessages)
      .where(and(eq(schema.conversationMessages.conversationId, a.conversationId), eq(schema.conversationMessages.body, REPLIES.firstCut)));
    expect(last.channel).toBe("sms");
  });
});

describe("POST /api/editor/uploads", () => {
  it("refuses without the worker's bearer secret, changing nothing", async () => {
    const id = await runningJob();
    const before = await snapshot(db);
    const files = { files: [{ name: "reel-15.mp4", contentType: "video/mp4" }] };
    expect((await uploads(id, files, null)).status).toBe(403);
    expect((await uploads(id, files, "Bearer wrong")).status).toBe(403);
    delete process.env.MODAL_EDITOR_SECRET;
    expect((await uploads(id, files)).status).toBe(403);
    expect(await snapshot(db)).toEqual(before);
    expect(r2.presignPut).not.toHaveBeenCalled();
  });

  it("gives a running job links under its own prefix only", async () => {
    const id = await runningJob();
    const res = await uploads(id, { files: [{ name: "reel-15.mp4", contentType: "video/mp4" }, { name: "check sheet.jpg", contentType: "image/jpeg" }] });
    expect(res.status).toBe(200);
    const { files } = await res.json();
    const prefix = `ws/${a.workspaceId}/conv/${a.conversationId}/preview/${id}/`;
    expect(files.map((f: { key: string }) => f.key)).toEqual([`${prefix}reel-15.mp4`, `${prefix}check-sheet.jpg`]);
    expect(files[0]).toMatchObject({ name: "reel-15.mp4", putUrl: expect.stringContaining(`${prefix}reel-15.mp4`) });
    expect(r2.presignPut).toHaveBeenCalledWith(`${prefix}reel-15.mp4`, 7200);
  });

  it("refuses jobs that are not running, unknown jobs, bad names, types and too many files", async () => {
    const done = await runningJob("done");
    const ok = { files: [{ name: "reel-15.mp4", contentType: "video/mp4" }] };
    expect((await uploads(done, ok)).status).toBe(409);
    expect((await uploads("99999999-9999-4999-8999-999999999999", ok)).status).toBe(404);
    expect((await uploads(null, ok)).status).toBe(404);
    const id = await runningJob();
    expect((await uploads(id, { files: [{ name: "../../raw/x.mp4", contentType: "video/mp4" }] })).status).toBe(400);
    expect((await uploads(id, { files: [{ name: "x.mov", contentType: "video/quicktime" }] })).status).toBe(400);
    expect((await uploads(id, { files: Array.from({ length: 25 }, (_, i) => ({ name: `c${i}.mp4`, contentType: "video/mp4" })) })).status).toBe(400);
    expect((await uploads(id, { files: [ok.files[0], ok.files[0]] })).status).toBe(400);
    expect(r2.presignPut).not.toHaveBeenCalled();
  });
});

describe("approving", () => {
  it("the Approve button approves the latest finished cut once and says so", async () => {
    const { editorJobId } = await seedEditorJob(db, a, "Alpha");
    const res = await approveRoute(new NextRequest("http://localhost/x", { method: "POST" }), ctx({ id: a.conversationId }));
    expect(res.status).toBe(200);
    const [job] = await jobs();
    expect(job).toMatchObject({ id: editorJobId, status: "approved" });
    expect(job.approvedAt).toBeInstanceOf(Date);
    const approved = await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.body, "Approved. Pick when it posts below."));
    expect(approved).toHaveLength(1);
    expect(approved[0].channel).toBe("app");
    expect((await approveRoute(new NextRequest("http://localhost/x", { method: "POST" }), ctx({ id: a.conversationId }))).status).toBe(409);
  });

  it("another workspace cannot approve it", async () => {
    await seedEditorJob(db, a, "Alpha");
    state.current = b.user;
    expect((await approveRoute(new NextRequest("http://localhost/x", { method: "POST" }), ctx({ id: a.conversationId }))).status).toBe(404);
    expect((await jobs())[0].status).toBe("done");
  });

  it('"yes" by text approves it too', async () => {
    await seedEditorJob(db, a, "Alpha");
    const result = await handleInbound({ workspaceId: a.workspaceId, userId: a.user.userId, channel: "sms", body: "yes", providerMessageId: "SMyes1" });
    expect(result.reply).toBe('Approved. When should it post? Reply NOW, TONIGHT, or a time like "tomorrow 9am".');
    expect((await jobs())[0].status).toBe("approved");
  });

  it("a time by text schedules an approved cut, and the same words are just a message before approval", async () => {
    await seedEditorJob(db, a, "Alpha");
    const before = await handleInbound({ workspaceId: a.workspaceId, userId: a.user.userId, channel: "sms", body: "tonight", providerMessageId: "SMt0" });
    expect(before.reply ?? "").not.toMatch(/^(Scheduled|Couldn't schedule)/);
    await handleInbound({ workspaceId: a.workspaceId, userId: a.user.userId, channel: "sms", body: "yes", providerMessageId: "SMt1" });
    const after = await handleInbound({ workspaceId: a.workspaceId, userId: a.user.userId, channel: "sms", body: "tonight", providerMessageId: "SMt2" });
    // Instagram isn't connected in tests, so scheduling is refused, but the time was understood as one.
    expect(after.reply).toMatch(/^(Scheduled for .+\. Reply UNDO to unschedule\.|Couldn't schedule it: .+)$/);
  });
});

describe("GET /api/conversations/[id]", () => {
  it("gives the editor reply its cuts and cost, and says when a job is running", async () => {
    const { editorMessageId, previewMediaId, editorJobId } = await seedEditorJob(db, a, "Alpha");
    let json = await (await threadRoute(new NextRequest("http://localhost/x"), ctx({ id: a.conversationId }))).json();
    const reply = json.messages.find((m: { id: string }) => m.id === editorMessageId);
    expect(reply.editor).toEqual({
      id: editorJobId,
      status: "done",
      costUsd: 1.42,
      approvable: true,
      cuts: [{ key: "cut-1", title: "Alpha cut", seconds: 15, previewId: previewMediaId, hookOptions: ["Alpha hook option"], caption: "Alpha cut caption", music: null }],
      steps: [],
      seconds: 300,
    });
    expect(JSON.stringify(reply)).not.toContain("ws/"); // never a storage key
    expect(json.editor).toEqual({ running: false, steps: [], startedAt: null });

    await runningJob();
    json = await (await threadRoute(new NextRequest("http://localhost/x"), ctx({ id: a.conversationId }))).json();
    expect(json.editor).toMatchObject({ running: true, steps: [] });
    expect(json.editor.startedAt).toEqual(expect.any(String));
  });
});
