import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, tableNames, type Seeded, type TestDb } from "@/app/api/__tests__/separation/world";
import type { Access } from "@/lib/auth/access";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
  delete process.env.APP_URL;
  return { current: null as unknown };
});

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeTestDb } = await import("@/app/api/__tests__/separation/world");
  return { ...actual, db: await makeTestDb() };
});
vi.mock("@/lib/auth/session", () => ({ getAccess: async () => state.current }));

import { requireConversation } from "../access";
import { handleInbound, handleIncomingText, ThreadClosedError } from "../handle";
import { publishDuePosts } from "@/lib/pipelines/publish";

let db: TestDb;
let a: Seeded;
let b: Seeded;

const threads = (workspaceId: string) => db.select().from(schema.conversations).where(eq(schema.conversations.workspaceId, workspaceId));
const openThreads = (workspaceId: string) =>
  db.select().from(schema.conversations).where(and(eq(schema.conversations.workspaceId, workspaceId), eq(schema.conversations.status, "open")));
const messages = (conversationId: string) =>
  db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, conversationId)).orderBy(schema.conversationMessages.createdAt, schema.conversationMessages.direction);

const sms = (who: Seeded, body: string, providerMessageId: string | null = null) =>
  handleInbound({ workspaceId: who.workspaceId, userId: who.user.userId, channel: "sms", body, providerMessageId, origin: "https://app.test" });

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  b = await seedWorkspace(db, "Beta", "00000000-0000-4000-8000-00000000000b");
  state.current = null;
});

describe("several videos at once", () => {
  it("new reel opens another thread and leaves the first one open", async () => {
    const result = await sms(a, "new reel");
    expect(result.conversationId).not.toBe(a.conversationId);
    const [old] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, a.conversationId));
    expect(old.status).toBe("open");
    const open = await openThreads(a.workspaceId);
    expect(open).toHaveLength(2);
    expect(open.find((t) => t.id === result.conversationId)).toMatchObject({ kind: "reel", brandId: a.brandId, startedVia: "sms" });
    expect(result.reply).toMatch(/^🫡 Message received\. New reel for Alpha brand started\. Tap to add your clips: https:\/\/app\.test\/u\/[A-Za-z0-9_-]{43}\n\nClips saved in iCloud load to your phone first\. If picking stalls, add them one at a time\.$/);
  });
});

describe("routing", () => {
  it("puts an ordinary message in the open thread and hands it to the editor seam", async () => {
    const result = await sms(a, "make it shorter");
    expect(result.conversationId).toBe(a.conversationId);
    expect(result.reply).toMatch(/editor isn't connected yet/);
    const rows = await messages(a.conversationId);
    expect(rows.map((m) => [m.direction, m.channel, m.body])).toEqual([
      ["in", "sms", "Alpha message"],
      ["in", "sms", "make it shorter"],
      ["out", "sms", result.reply],
    ]);
  });

  it("opens a thread and asks Reel or story?, then asks the brand once and remembers the answer", async () => {
    await db.update(schema.conversations).set({ status: "closed" });
    await db.insert(schema.brands).values({ workspaceId: a.workspaceId, name: "Windansea Coconuts", slug: "windansea-coconuts", status: "active" });

    const first = await sms(a, "hello there");
    expect(first.conversationId).not.toBe(a.conversationId);
    expect(first.reply).toMatch(/Reel or story\?$/);

    const second = await sms(a, "reel");
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.reply).toBe("Got it. Which brand: Alpha brand or Windansea Coconuts?");

    const third = await sms(a, "windandsea");
    expect(third.reply).toContain("Got it: a reel for Windansea Coconuts.");
    const [thread] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, first.conversationId!));
    expect(thread.kind).toBe("reel");
    expect(thread.brandId).not.toBeNull();
    expect(thread.brandId).not.toBe(a.brandId);
  });

  it("asks which brand only once per thread", async () => {
    await db.insert(schema.brands).values({ workspaceId: a.workspaceId, name: "Other", slug: "other", status: "active" });
    const started = await sms(a, "new story");
    expect(started.reply).toContain("Which brand: Alpha brand or Other?");
    const next = await sms(a, "use the beach clip");
    expect(next.reply).not.toContain("Which brand");
  });

  it("stores yes and replies that nothing is waiting", async () => {
    const result = await sms(a, "yes");
    expect(result.reply).toBe("There's nothing waiting for your approval yet.");
    const rows = await messages(a.conversationId);
    expect(rows.at(-2)?.body).toBe("yes");
  });

  it("refuses an app message into a closed thread, but takes new reel there", async () => {
    await db.update(schema.conversations).set({ status: "closed" });
    const app = (body: string) =>
      handleInbound({ workspaceId: a.workspaceId, userId: a.user.userId, channel: "app", body, threadId: a.conversationId });
    await expect(app("shorter")).rejects.toBeInstanceOf(ThreadClosedError);
    const fresh = await app("new story");
    expect(fresh.reply).toBe("New story for Alpha brand started. Add your clips with the paperclip below, or drop them in.");
  });
});

describe("retries", () => {
  it("stores a retried MessageSid once and answers it the same way", async () => {
    const first = await sms(a, "make it shorter", "SM-retry-1");
    const again = await sms(a, "make it shorter", "SM-retry-1");
    expect(again).toMatchObject({ conversationId: first.conversationId, reply: first.reply, duplicate: true });
    const stored = await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.providerMessageId, "SM-retry-1"));
    expect(stored).toHaveLength(1);
    expect((await messages(a.conversationId)).filter((m) => m.direction === "out")).toHaveLength(1);
  });
});

describe("publishing", () => {
  it("closes the thread linked to the post, recording why", async () => {
    await db.update(schema.posts).set({ status: "queued", scheduledFor: new Date(Date.now() - 60_000), publishedAt: null }).where(eq(schema.posts.id, a.postId));
    await db.update(schema.conversations).set({ postId: a.postId }).where(eq(schema.conversations.id, a.conversationId));
    const result = await publishDuePosts({
      db: db as never,
      getPublisherFor: () => ({ publish: async () => ({ externalId: "ig-1", url: "https://instagram.test/p/1" }) }) as never,
    });
    expect(result.published).toBe(1);
    const [thread] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, a.conversationId));
    expect(thread).toMatchObject({ status: "closed", closedReason: "published" });
    const [other] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, b.conversationId));
    expect(other.status).toBe("open");
  });
});

describe("separation", () => {
  it("never lands one workspace's message in another workspace's thread", async () => {
    const before = await messages(b.conversationId);
    await sms(a, "make it shorter");
    await sms(a, "new reel beta");
    await handleIncomingText({ from: a.phone, body: "use the beta brand clip", messageSid: "SM-a-1" });
    expect(await messages(b.conversationId)).toEqual(before);
    expect(await threads(b.workspaceId)).toHaveLength(1);
    // Beta's brand is not a choice for Alpha: "new reel beta" stays on Alpha's own brand.
    const [open] = await openThreads(a.workspaceId);
    expect(open.brandId).toBe(a.brandId);
  });

  it("refuses an app message aimed at another workspace's thread", async () => {
    await expect(
      handleInbound({ workspaceId: a.workspaceId, userId: a.user.userId, channel: "app", body: "hi", threadId: b.conversationId }),
    ).rejects.toMatchObject({ status: 404 });
    state.current = { ...a.user } satisfies Access;
    await expect(requireConversation(b.conversationId)).rejects.toMatchObject({ status: 404 });
    await expect(requireConversation("not-a-uuid")).rejects.toMatchObject({ status: 404 });
    await expect(requireConversation(a.conversationId)).resolves.toMatchObject({ workspaceId: a.workspaceId });
  });

  it("texts land in the sender's first (oldest) workspace when they belong to several", async () => {
    await db.insert(schema.workspaceMembers).values({ workspaceId: b.workspaceId, userId: a.user.userId, role: "staff" });
    await handleIncomingText({ from: a.phone, body: "make it shorter", messageSid: "SM-a-2" });
    const [stored] = await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.providerMessageId, "SM-a-2"));
    expect(stored.conversationId).toBe(a.conversationId);
  });
});

describe("texts across several open videos", () => {
  const name = (id: string, title: string) => db.update(schema.conversations).set({ title }).where(eq(schema.conversations.id, id));

  it("go to the video the person last heard about, and say its name", async () => {
    const second = await sms(a, "new reel");
    await name(a.conversationId, "Cider Stand Opening");
    await name(second.conversationId!, "Fall Arch");
    const r = await sms(a, "make it shorter");
    expect(r.conversationId).toBe(second.conversationId);
    expect(r.reply === null || r.reply.startsWith("[Fall Arch] ")).toBe(true);
  });

  it("can be aimed at a video by its name", async () => {
    const second = await sms(a, "new reel");
    await name(a.conversationId, "Cider Stand Opening");
    await name(second.conversationId!, "Fall Arch");
    const r = await sms(a, "cider stand: make it shorter");
    expect(r.conversationId).toBe(a.conversationId);
    const [last] = (await messages(a.conversationId)).filter((m) => m.direction === "in").slice(-1);
    expect(last.body).toBe("make it shorter");
  });

  it("ask which one when a bare yes could approve two videos", async () => {
    const second = await sms(a, "new reel");
    await name(a.conversationId, "Cider Stand Opening");
    await name(second.conversationId!, "Fall Arch");
    for (const id of [a.conversationId, second.conversationId!]) {
      await db.insert(schema.editorJobs).values({ conversationId: id, workspaceId: a.workspaceId, kind: "first_cut", model: "test", status: "done", manifest: { cuts: [] } } as never);
    }
    const r = await sms(a, "yes");
    expect(r.conversationId).toBeNull();
    expect(r.reply).toMatch(/^Which one: "(Cider Stand Opening|Fall Arch)" or "(Cider Stand Opening|Fall Arch)"\? Reply with its name first/);
  });
});
