import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedEditorJob, seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
import type { ConversationAccess } from "@/lib/conversations/access";
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

import { cancelScheduledPost, scheduledPostFor, scheduleEditorCut } from "../schedule";

let db: TestDb;
let a: Seeded;
let b: Seeded;
let jobId: string;
const LATER = new Date(Date.now() + 3 * 60 * 60 * 1000);

async function accessFor(s: Seeded): Promise<ConversationAccess> {
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, s.conversationId));
  return { user: s.user, workspaceId: s.workspaceId, role: "owner", conversation };
}
const approve = () => db.update(schema.editorJobs).set({ status: "approved", approvedAt: new Date() }).where(eq(schema.editorJobs.id, jobId));

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Beta", "00000000-0000-4000-8000-00000000000b");
  ({ editorJobId: jobId } = await seedEditorJob(db, a, "Alpha"));
});

describe("scheduleEditorCut", () => {
  it("refuses a cut that has not been approved", async () => {
    await expect(scheduleEditorCut({ access: await accessFor(a), jobId, cutId: "cut-1", when: LATER })).rejects.toThrow("Approve the cut");
  });

  it("puts an approved cut on the calendar as a Reel from R2, with its caption, cover and the thread linked", async () => {
    await approve();
    const done = await scheduleEditorCut({ access: await accessFor(a), jobId, cutId: "cut-1", when: LATER });
    expect(done).toMatchObject({ format: "reel", title: "Alpha cut", when: LATER });

    const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, done.postId));
    expect(post).toMatchObject({ status: "queued", brandId: a.brandId, scheduledFor: LATER });
    const [draft] = await db.select().from(schema.drafts).where(eq(schema.drafts.id, post.draftId));
    expect(draft).toMatchObject({ format: "reel", caption: "Alpha cut caption", status: "scheduled" });
    expect(draft.metaJson).toMatchObject({ editorJobId: jobId, cutId: "cut-1", conversationId: a.conversationId, coverAtMs: 1000, trialReel: "manual" });
    const [link] = await db.select().from(schema.draftAssets).where(eq(schema.draftAssets.draftId, draft.id));
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, link.assetId));
    expect(asset.storageUrl).toMatch(/^r2:\/\/.+\.mp4$/);
    const [thread] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, a.conversationId));
    expect(thread.postId).toBe(done.postId);
    expect(await scheduledPostFor(jobId, "cut-1")).toMatchObject({ postId: done.postId, status: "queued" });
  });

  it("posts a story thread as an Instagram Story, with no trial mode", async () => {
    await approve();
    await db.update(schema.conversations).set({ kind: "story" }).where(eq(schema.conversations.id, a.conversationId));
    const done = await scheduleEditorCut({ access: await accessFor(a), jobId, cutId: "cut-1", when: LATER });
    expect(done.format).toBe("story");
    const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, done.postId));
    const [draft] = await db.select().from(schema.drafts).where(eq(schema.drafts.id, post.draftId));
    expect(draft.format).toBe("story");
    expect(draft.metaJson.trialReel).toBeNull();
  });

  it("moves the time when scheduled again, instead of making a second post; a past time means now", async () => {
    await approve();
    const access = await accessFor(a);
    const first = await scheduleEditorCut({ access, jobId, cutId: "cut-1", when: LATER });
    const before = Date.now();
    const again = await scheduleEditorCut({ access, jobId, cutId: "cut-1", when: new Date(0) });
    expect(again.postId).toBe(first.postId);
    expect(again.when.getTime()).toBeGreaterThanOrEqual(before);
    expect((await db.select().from(schema.posts).where(eq(schema.posts.brandId, a.brandId))).filter((p) => p.id === first.postId)).toHaveLength(1);
  });

  it("never schedules another workspace's job or an unknown cut", async () => {
    await approve();
    await expect(scheduleEditorCut({ access: await accessFor(b), jobId, cutId: "cut-1", when: LATER })).rejects.toMatchObject({ status: 404 });
    await expect(scheduleEditorCut({ access: await accessFor(a), jobId, cutId: "nope", when: LATER })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a brand without a connected Instagram account", async () => {
    await approve();
    await db.update(schema.channelConnections).set({ status: "revoked" }).where(eq(schema.channelConnections.brandId, a.brandId));
    await expect(scheduleEditorCut({ access: await accessFor(a), jobId, cutId: "cut-1", when: LATER })).rejects.toThrow("no connected Instagram");
  });
});

describe("cancelScheduledPost", () => {
  it("takes a queued post off the calendar, keeps the draft as a record, and unlinks the thread", async () => {
    await approve();
    const { postId } = await scheduleEditorCut({ access: await accessFor(a), jobId, cutId: "cut-1", when: LATER });
    expect(await cancelScheduledPost(postId, b.workspaceId)).toBe(false); // not theirs
    expect(await cancelScheduledPost(postId, a.workspaceId)).toBe(true);
    expect(await db.select().from(schema.posts).where(eq(schema.posts.id, postId))).toEqual([]);
    expect(await scheduledPostFor(jobId, "cut-1")).toBeNull();
    const [thread] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, a.conversationId));
    expect(thread.postId).toBeNull();
    const drafts = await db.select().from(schema.drafts).where(eq(schema.drafts.brandId, a.brandId));
    expect(drafts.find((d) => d.metaJson.editorJobId === jobId)).toMatchObject({ status: "rejected" });
  });

  it("leaves a post that is publishing or published alone", async () => {
    await approve();
    const { postId } = await scheduleEditorCut({ access: await accessFor(a), jobId, cutId: "cut-1", when: LATER });
    await db.update(schema.posts).set({ status: "publishing", externalContainerId: "c1" }).where(eq(schema.posts.id, postId));
    expect(await cancelScheduledPost(postId, a.workspaceId)).toBe(false);
    await db.update(schema.posts).set({ status: "published" }).where(eq(schema.posts.id, postId));
    expect(await cancelScheduledPost(postId, a.workspaceId)).toBe(false);
  });
});
