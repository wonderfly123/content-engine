/**
 * Campaign chats: brainstorm -> plan -> "go" makes exactly one video -> approve schedules it at its
 * plan date. In-memory database; Claude, the editor worker and R2 are mocked.
 */
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  presignGet: vi.fn((key: string, expires?: number) => `https://r2.test/get/${key}?exp=${expires}`),
  presignPut: vi.fn((key: string, expires?: number) => `https://r2.test/put/${key}?exp=${expires}`),
  headObject: vi.fn(async () => ({ size: 4321, contentType: "video/mp4", etag: '"e"' })),
}));
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, ...r2 };
});

import { POST as approveRoute } from "@/app/api/conversations/[id]/approve/route";
import { GET as campaignGet, POST as campaignPost } from "@/app/api/conversations/[id]/campaign/route";
import { POST as messagesRoute } from "@/app/api/conversations/[id]/messages/route";
import { POST as createRoute } from "@/app/api/conversations/route";
import { CAMPAIGN_OPENER } from "@/lib/campaigns/chat";
import { brandLibrary, libraryMedia } from "@/lib/campaigns/store";
import { applyEditorResult } from "@/lib/editor/callback";
import { buildMediaKey, buildPreviewKey } from "@/lib/storage/keys";

const WORKER = "https://nekter--editor-submit.modal.run";
let db: TestDb;
let a: Seeded;
let b: Seeded;
let assetId: string;
let campaignId: string;
let claudeQueue: unknown[];
let claudeCalls: Array<{ headers: Record<string, string>; body: Record<string, unknown> }>;
let workerCalls: Array<Record<string, unknown>>;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const say = async (body: string) => (await messagesRoute(json(`/api/conversations/${campaignId}/messages`, { body }), ctx(campaignId))).json();
const view = async () => (await (await campaignGet(new NextRequest("http://localhost/x"), ctx(campaignId))).json()).campaign;
const jobs = () => db.select().from(schema.editorJobs).where(eq(schema.editorJobs.conversationId, campaignId));
const items = () => db.select().from(schema.campaignItems).orderBy(schema.campaignItems.position);

const day = (n: number, hour = 17) => new Date(Date.UTC(2030, 0, n, hour)).toISOString();
const planItem = (over: Record<string, unknown> = {}) => ({
  number: 0,
  title: "Truck day",
  angle: "The build starts with a truck",
  hook: "Everything you see came off this truck",
  lengthSec: 30,
  format: "reel",
  music: "upbeat, cuts on the beat",
  clips: ["c1"],
  postAt: day(3),
  ...over,
});
const plan = (itemsList: unknown[]) => ({ name: "Spring Launch", theme: "spring", goal: "new customers", audience: "locals", items: itemsList });
const emptyPlan = { name: "", theme: "", goal: "", audience: "", items: [] };
const claude = (out: Record<string, unknown>) => claudeQueue.push(out);

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Bravo", "00000000-0000-4000-8000-00000000000b");
  state.current = a.user;
  vi.clearAllMocks();
  claudeQueue = [];
  claudeCalls = [];
  workerCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).startsWith("https://api.anthropic.com")) {
        claudeCalls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
        const out = claudeQueue.shift() ?? { reply: "Tell me more.", action: "chat", plan: emptyPlan };
        return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] }), { status: 200 });
      }
      workerCalls.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }),
  );
  process.env.MODAL_EDITOR_URL = WORKER;
  process.env.MODAL_EDITOR_SECRET = "test-editor-secret";
  process.env.APP_URL = "https://app.test";
  // A clip from Alpha's reel chat, filed in Alpha's library: the campaign may use it.
  [{ id: assetId }] = await db
    .insert(schema.assets)
    .values({ brandId: a.brandId, kind: "video", label: "Truck loading", description: "Two people load a truck", tags: ["truck loading", "wide"], storageUrl: "r2://x", mediaObjectId: a.mediaId, durationSec: 12 })
    .returning({ id: schema.assets.id });
  const created = await (await createRoute(json("/api/conversations", { brandId: a.brandId, kind: "campaign" }))).json();
  campaignId = created.conversationId;
});

afterEach(() => {
  for (const k of ["MODAL_EDITOR_URL", "MODAL_EDITOR_SECRET", "APP_URL"]) delete process.env[k];
});

/** Brainstorm, then write a plan of the given items. */
async function writePlan(list = [planItem({ title: "Second", postAt: day(5), format: "story", lengthSec: 15 }), planItem()]) {
  claude({ reply: "Here's the plan.", action: "write_plan", plan: plan(list) });
  return say("make the plan");
}

/** The worker's result for a job, naming the given clip. */
async function finish(jobId: string, mediaId: string) {
  const key = buildPreviewKey({ workspaceId: a.workspaceId, conversationId: campaignId, jobId, filename: "reel-30.mp4" });
  return applyEditorResult({
    jobId,
    ok: true,
    reply: "Here it is.",
    manifest: {
      cuts: [{ id: "reel-30", title: "Truck day", seconds: 30, mode: "music", preview: { key }, edl: [{ mediaId, in: 0, dur: 3, speed: 1, cropX: null }], hookOptions: [], caption: "c", script: null, coverAt: 1 }],
    },
  });
}

describe("starting a campaign", () => {
  it("New campaign opens a campaign chat with the editor's first question and no plan", async () => {
    const [thread] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, campaignId));
    expect(thread).toMatchObject({ kind: "campaign", brandId: a.brandId, workspaceId: a.workspaceId, startedVia: "app", status: "open" });
    const msgs = await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, campaignId));
    expect(msgs.map((m) => m.body)).toEqual([CAMPAIGN_OPENER]);
    expect(await view()).toMatchObject({ planWritten: false, items: [], canMakeNext: false });
  });
});

describe("texts", () => {
  it("never land in a campaign chat, even the most recent one", async () => {
    await say("hello"); // the campaign is now the newest activity
    const { handleInbound } = await import("@/lib/conversations/handle");
    const res = await handleInbound({ workspaceId: a.workspaceId, userId: a.user.userId, channel: "sms", body: "make it shorter" });
    expect(res.conversationId).toBe(a.conversationId);
  });
});

describe("brainstorm -> plan", () => {
  it("talks first: the top model with the workspace's key and the brand's library, and writes no plan", async () => {
    claude({ reply: "Who is it for?", action: "chat", plan: emptyPlan });
    const res = await say("A spring launch for the new cider");
    expect(res.reply).toBe("Who is it for?");
    expect(claudeCalls).toHaveLength(1);
    const { headers, body } = claudeCalls[0];
    expect(headers["x-api-key"]).toBe("Alpha-anthropic-key");
    expect(body.model).toBe("claude-opus-5-5");
    expect((body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    const system = body.system as Array<{ text: string }>;
    expect(system[0].text).toContain("c1 | Truck loading | 12s | Two people load a truck | truck loading, wide");
    expect(system[1].text).toContain("No plan yet.");
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("user");
    expect(messages.at(-1)).toEqual({ role: "user", content: "A spring launch for the new cider" });
    expect(await items()).toEqual([]);
  });

  it("never lists another brand's or workspace's clips", async () => {
    const lib = await brandLibrary(a.brandId, a.workspaceId);
    expect(lib.map((c) => c.assetId)).toEqual([assetId]);
    expect(await brandLibrary(a.brandId, b.workspaceId)).toEqual([]);
  });

  it("writes the plan when asked: checked, numbered in posting order, clips mapped to this library only", async () => {
    const res = await writePlan([
      planItem({ title: "Second", postAt: day(5), format: "story", lengthSec: 15, clips: ["c1", "c99"] }),
      planItem({ title: "First", postAt: day(3), lengthSec: 45 }),
    ]);
    expect(res.reply).toBe("Here's the plan.");
    const rows = await items();
    expect(rows.map((r) => [r.position, r.title, r.format, r.lengthSec])).toEqual([
      [1, "First", "reel", 30],
      [2, "Second", "story", 15],
    ]);
    expect(rows[1].assetIds).toEqual([assetId]);
    const [thread] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, campaignId));
    expect(thread.title).toBe("Spring Launch");
    const v = await view();
    expect(v).toMatchObject({ name: "Spring Launch", planWritten: true, calendarApproved: false, canMakeNext: true, active: null });
    expect(v.items.map((i: { status: string }) => i.status)).toEqual(["planned", "planned"]);
    expect(v.items[1].clips).toEqual([{ assetId, label: "Truck loading" }]);
    expect(workerCalls).toHaveLength(0); // nothing renders until go
  });

  it("changes the plan in chat ('drop #2'), and never touches a video already being made", async () => {
    await writePlan([planItem({ title: "One", postAt: day(3) }), planItem({ title: "Two", postAt: day(4) }), planItem({ title: "Three", postAt: day(5) })]);
    await say("go"); // #1 is being made: locked
    claude({ reply: "Dropped #2.", action: "write_plan", plan: plan([planItem({ number: 1, title: "Renamed one", postAt: day(9) }), planItem({ number: 3, title: "Three", postAt: day(5) })]) });
    await say("drop #2");
    const rows = await items();
    expect(rows.map((r) => r.title)).toEqual(["One", "Three"]);
    expect((await jobs())[0].campaignItemId).toBe(rows[0].id);
  });
});

describe("making videos, one at a time", () => {
  it("'go' starts exactly one job for the next item, with its brief and its library clips from another chat", async () => {
    await writePlan();
    const res = await say("go");
    expect(res.reply).toMatch(/^Making #1: Truck day \(30s reel\)/);
    const all = await jobs();
    expect(all).toHaveLength(1);
    const [first] = await items();
    expect(all[0]).toMatchObject({ status: "running", kind: "first_cut", campaignItemId: first.id, clipIds: [a.mediaId] });
    expect(workerCalls).toHaveLength(1);
    const sent = workerCalls[0] as { request: string; videoKind: string; clips: Array<{ mediaId: string }>; instructions: string };
    expect(sent.videoKind).toBe("reel");
    expect(sent.request).toContain("exactly one cut, 30 seconds long, as a reel");
    expect(sent.request).toContain("Open on this hook: Everything you see came off this truck");
    expect(sent.request).toContain("Music and pacing: upbeat, cuts on the beat");
    expect(sent.instructions).toContain("Spring Launch");
    expect(sent.clips.map((c) => c.mediaId)).toEqual([a.mediaId]);
    expect((await view()).calendarApproved).toBe(true); // go approves the calendar

    // Again, by chat or button: still one job, nothing else starts.
    expect((await say("next")).reply).toBe("Still making #1. I'll post it here as soon as it's ready.");
    await campaignPost(json(`/api/conversations/${campaignId}/campaign`, { action: "next" }), ctx(campaignId));
    expect(await jobs()).toHaveLength(1);
    expect(workerCalls).toHaveLength(1);
  });

  it("approving the ready video schedules it at its plan date, as its format, and does not start the next", async () => {
    await writePlan([planItem({ title: "Story one", format: "story", lengthSec: 15, postAt: day(3) }), planItem({ title: "Next", postAt: day(6) })]);
    await say("go");
    const [job] = await jobs();
    expect((await finish(job.id, a.mediaId)).status).toBe(200);
    expect((await view()).items[0].status).toBe("ready");
    expect((await say("go")).reply).toBe("#1 is ready above: approve it, or tell me what to change first.");

    const res = await approveRoute(json(`/api/conversations/${campaignId}/approve`, { jobId: job.id }), ctx(campaignId));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.reply).toMatch(/^Approved #1\. Scheduled for .+ Say go .+ #2\.$/);
    const [approved] = await jobs();
    expect(approved.status).toBe("approved");
    const [post] = await db
      .select({ when: schema.posts.scheduledFor, format: schema.drafts.format, title: schema.drafts.metaJson })
      .from(schema.posts)
      .innerJoin(schema.drafts, eq(schema.drafts.id, schema.posts.draftId))
      .where(sql`${schema.drafts.metaJson}->>'editorJobId' = ${job.id}`);
    expect(post.when.toISOString()).toBe(day(3));
    expect(post.format).toBe("story");
    // The campaign chat stays open through every post: it is not tied to this one.
    const [thread] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, campaignId));
    expect(thread.postId).toBeNull();
    expect((await view()).items.map((i: { status: string }) => i.status)).toEqual(["scheduled", "planned"]);
    expect(await jobs()).toHaveLength(1);
  });

  it("'yes' approves the ready video; anything else revises that same video", async () => {
    await writePlan();
    await say("go");
    const [job] = await jobs();
    await finish(job.id, a.mediaId);
    expect((await say("make the hook bigger")).reply).toBe("On it: a new version of #1. I'll post it here when it's ready.");
    const all = await jobs();
    expect(all).toHaveLength(2);
    const revision = all.find((j) => j.id !== job.id)!;
    expect(revision).toMatchObject({ kind: "revision", campaignItemId: job.campaignItemId });
    expect((workerCalls[1] as { previous: { manifest: unknown } }).previous.manifest).toBeTruthy();
    await finish(revision.id, a.mediaId);
    expect((await say("yes")).reply).toMatch(/^Approved #1\./);
    expect((await db.select().from(schema.editorJobs).where(eq(schema.editorJobs.id, revision.id)))[0].status).toBe("approved");
  });
});

describe("footage from other chats: same workspace and brand only", () => {
  it("never sends another workspace's or another brand's library clips", async () => {
    const [otherBrand] = await db.insert(schema.brands).values({ workspaceId: a.workspaceId, name: "Other", slug: "other", status: "active" }).returning();
    const [otherThread] = await db
      .insert(schema.conversations)
      .values({ workspaceId: a.workspaceId, brandId: otherBrand.id, kind: "reel", startedVia: "app", startedBy: a.user.userId })
      .returning();
    const mediaId = crypto.randomUUID();
    await db.insert(schema.mediaObjects).values({
      id: mediaId,
      workspaceId: a.workspaceId,
      brandId: otherBrand.id,
      conversationId: otherThread.id,
      kind: "raw",
      r2Key: buildMediaKey({ workspaceId: a.workspaceId, conversationId: otherThread.id, filename: "o.mov", id: mediaId }),
      filename: "o.mov",
      contentType: "video/quicktime",
      sizeBytes: 10,
      status: "ready",
      uploadedBy: a.user.userId,
    });
    const [otherAsset] = await db.insert(schema.assets).values({ brandId: otherBrand.id, kind: "video", storageUrl: "r2://o", mediaObjectId: mediaId }).returning();
    const [victimAsset] = await db.insert(schema.assets).values({ brandId: b.brandId, kind: "video", storageUrl: "r2://v", mediaObjectId: b.mediaId }).returning();

    expect(await libraryMedia([otherAsset.id, victimAsset.id], a.brandId, a.workspaceId)).toEqual([]);
    expect((await libraryMedia([assetId, victimAsset.id], a.brandId, a.workspaceId)).map((m) => m.id)).toEqual([a.mediaId]);

    // A plan item naming only those (as if tampered with) has no footage: nothing is sent.
    await writePlan([planItem()]);
    await db.update(schema.campaignItems).set({ assetIds: [otherAsset.id, victimAsset.id] });
    expect((await say("go")).reply).toBe("There's no footage for #1 yet. Upload clips here, or ask me to pick library clips for it.");
    expect(workerCalls).toHaveLength(0);
  });

  it("the callback rejects an edit naming a clip of another workspace or another brand, even one the job lists", async () => {
    await writePlan();
    await say("go");
    const [job] = await jobs();
    // The job's list says it was sent the victim's clip (it never was): still rejected.
    await db.update(schema.editorJobs).set({ clipIds: [a.mediaId, b.mediaId] }).where(eq(schema.editorJobs.id, job.id));
    const res = await finish(job.id, b.mediaId);
    expect(res.status).toBe(422);
    expect((await jobs())[0].status).toBe("failed");

    await db.update(schema.editorJobs).set({ status: "running", error: null }).where(eq(schema.editorJobs.id, job.id));
    const [otherBrand] = await db.insert(schema.brands).values({ workspaceId: a.workspaceId, name: "Other", slug: "other2", status: "active" }).returning();
    const mediaId = crypto.randomUUID();
    await db.insert(schema.mediaObjects).values({
      id: mediaId,
      workspaceId: a.workspaceId,
      brandId: otherBrand.id,
      kind: "raw",
      r2Key: buildMediaKey({ workspaceId: a.workspaceId, conversationId: a.conversationId, filename: "x.mov", id: mediaId }),
      filename: "x.mov",
      contentType: "video/quicktime",
      sizeBytes: 10,
      status: "ready",
      uploadedBy: a.user.userId,
    });
    await db.update(schema.editorJobs).set({ clipIds: [a.mediaId, mediaId] }).where(eq(schema.editorJobs.id, job.id));
    expect((await finish(job.id, mediaId)).status).toBe(422);

    // The library clip it was really sent (same workspace and brand, another chat) is fine.
    await db.update(schema.editorJobs).set({ status: "running", error: null }).where(eq(schema.editorJobs.id, job.id));
    expect((await finish(job.id, a.mediaId)).status).toBe(200);
  });

  it("a job that was sent no library clips may only name its own chat's clips", async () => {
    const [job] = await db
      .insert(schema.editorJobs)
      .values({ workspaceId: a.workspaceId, conversationId: campaignId, brandId: a.brandId, kind: "first_cut", status: "running", model: "claude-opus-5-5", startedAt: new Date() })
      .returning();
    expect((await finish(job.id, a.mediaId)).status).toBe(422); // not sent, not in this chat
    expect((await db.select().from(schema.editorJobs).where(and(eq(schema.editorJobs.id, job.id))))[0].status).toBe("failed");
  });
});
