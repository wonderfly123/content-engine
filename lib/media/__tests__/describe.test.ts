/**
 * Uploaded clips land in the brand's Assets library and get described and tagged by AI: the
 * optimizer's callback files the clip, the frames worker sends back a contact sheet, Claude
 * describes it. In-memory database; R2, the worker endpoints and Claude are mocked.
 */
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/credentials/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/credentials/store")>("@/lib/credentials/store");
  return { ...actual, getCredential: vi.fn(async () => "sk-test") };
});

const r2 = vi.hoisted(() => ({
  presignGet: vi.fn((key: string) => `https://r2.test/get/${key}`),
  presignPut: vi.fn((key: string) => `https://r2.test/put/${key}`),
  headObject: vi.fn(async (): Promise<{ size: number; contentType: string | null; etag: string | null } | null> => ({ size: 500, contentType: "video/mp4", etag: '"x"' })),
  deleteObject: vi.fn(async () => undefined),
}));
vi.mock("@/lib/storage/r2", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/r2")>("@/lib/storage/r2");
  return { ...actual, ...r2 };
});

import { POST as frames } from "@/app/api/media/frames/route";
import { POST as optimized } from "@/app/api/media/optimized/route";
import { tagsFor } from "@/lib/media/describe";
import { signWorkerBody } from "@/lib/media/worker-signature";
import { buildMediaKey } from "@/lib/storage/keys";

const SECRET = "test-optimize-secret";
const JOB = "11111111-1111-4111-8111-111111111111";
const FRAMES_URL = "https://nekter--frames-submit.modal.run";
let db: TestDb;
let a: Seeded;
let fetchMock: ReturnType<typeof vi.fn>;

const claudeAnswer = {
  stop_reason: "end_turn",
  content: [
    {
      type: "text",
      text: JSON.stringify({
        title: "Loading The Cider Stand",
        description: "Two people load a wooden cider stand into a box truck at night.",
        activity: ["Truck Loading", "cider stand"],
        shot: ["wide"],
        setting: ["outdoor", "night", "small group"],
      }),
    },
  ],
};

const signed = (route: typeof frames, url: string, payload: unknown, signature: string | null = signWorkerBody(SECRET, JSON.stringify(payload))) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-nekter-signature"] = signature;
  return route(new NextRequest(url, { method: "POST", body: JSON.stringify(payload), headers }));
};
const asset = async () => (await db.select().from(schema.assets).where(eq(schema.assets.mediaObjectId, a.mediaId)))[0];

/** Alpha's clip goes through the optimizer and comes back ready: that files it in the library. */
async function optimizeAlphaClip() {
  const incoming = buildMediaKey({ workspaceId: a.workspaceId, conversationId: a.conversationId, filename: "IMG_6974.MOV", id: a.mediaId, kind: "incoming" });
  await db.update(schema.mediaObjects).set({ status: "processing", optimizeJobId: JOB, r2Key: incoming }).where(eq(schema.mediaObjects.id, a.mediaId));
  const res = await signed(optimized, "http://localhost/api/media/optimized", { jobId: JOB, mediaId: a.mediaId, ok: true, sizeBytes: 500, codec: "hevc" });
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  db = (await import("@/lib/db")).db as unknown as TestDb;
  const names = (await tableNames(db)).map((n) => `"${n}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} cascade`));
  a = await seedWorkspace(db, "Alpha", "00000000-0000-4000-8000-00000000000a");
  await db.update(schema.conversations).set({ title: "Bloomingdale's Truck Load" }).where(eq(schema.conversations.id, a.conversationId));
  vi.clearAllMocks();
  fetchMock = vi.fn(async (url: string) =>
    url.includes("anthropic.com") ? new Response(JSON.stringify(claudeAnswer), { status: 200 }) : new Response(JSON.stringify({ accepted: true }), { status: 202 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  process.env.MODAL_OPTIMIZE_SECRET = SECRET;
  process.env.MODAL_FRAMES_URL = FRAMES_URL;
  process.env.APP_URL = "https://app.nekter.test";
});

describe("a ready clip lands in the library", () => {
  it("files it once, tagged with its project only, and asks the worker for frames", async () => {
    await optimizeAlphaClip();
    const row = await asset();
    expect(row).toMatchObject({ brandId: a.brandId, kind: "video", label: "Bloomingdale's Truck Load", tags: ["Bloomingdale's Truck Load"], describeStatus: "pending" });
    expect(row.storageUrl).toBe(`r2://ws/${a.workspaceId}/conv/${a.conversationId}/raw/${a.mediaId}.mp4`);
    // No words from the file name.
    expect(row.tags.join(" ")).not.toMatch(/img|6974/i);

    const call = fetchMock.mock.calls.find(([url]) => url === FRAMES_URL) as [string, RequestInit];
    const job = JSON.parse(call[1].body as string);
    expect(Object.keys(job).sort()).toEqual(["assetId", "callbackUrl", "jobId", "sheetUrl", "sourceUrl", "thumbUrl"]);
    expect(job).toMatchObject({ assetId: row.id, jobId: row.describeJobId, callbackUrl: "https://app.nekter.test/api/media/frames" });
    expect(job.sheetUrl).toBe(`https://r2.test/put/ws/${a.workspaceId}/frames/${row.id}-sheet.jpg`);
  });

  it("without MODAL_FRAMES_URL it is filed, untagged, with the reason", async () => {
    delete process.env.MODAL_FRAMES_URL;
    await optimizeAlphaClip();
    expect(await asset()).toMatchObject({ describeStatus: "failed", describeError: expect.stringContaining("MODAL_FRAMES_URL") });
  });
});

describe("the frames callback", () => {
  it("refuses an unsigned callback", async () => {
    await optimizeAlphaClip();
    const row = await asset();
    const res = await signed(frames, "http://localhost/api/media/frames", { jobId: row.describeJobId, assetId: row.id, ok: true }, null);
    expect(res.status).toBe(403);
    expect((await asset()).describeStatus).toBe("pending");
  });

  it("has Claude describe the contact sheet and saves title, description, tags and thumbnail", async () => {
    await optimizeAlphaClip();
    const row = await asset();
    const res = await signed(frames, "http://localhost/api/media/frames", { jobId: row.describeJobId, assetId: row.id, ok: true, durationSec: 12.4 });
    expect(res.status).toBe(200);

    const claude = fetchMock.mock.calls.find(([url]) => String(url).includes("anthropic.com")) as [string, RequestInit];
    const body = JSON.parse(claude[1].body as string);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.messages[0].content[0]).toEqual({ type: "image", source: { type: "url", url: `https://r2.test/get/ws/${a.workspaceId}/frames/${row.id}-sheet.jpg` } });

    expect(await asset()).toMatchObject({
      label: "Loading The Cider Stand",
      description: "Two people load a wooden cider stand into a box truck at night.",
      tags: ["Bloomingdale's Truck Load", "truck loading", "cider stand", "wide", "outdoor", "night", "small group"],
      thumbnailUrl: `r2://ws/${a.workspaceId}/frames/${row.id}-thumb.jpg`,
      durationSec: 12,
      describeStatus: "done",
    });

    // A repeated callback changes nothing.
    fetchMock.mockClear();
    await signed(frames, "http://localhost/api/media/frames", { jobId: row.describeJobId, assetId: row.id, ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records the worker's failure", async () => {
    await optimizeAlphaClip();
    const row = await asset();
    await signed(frames, "http://localhost/api/media/frames", { jobId: row.describeJobId, assetId: row.id, ok: false, error: "The clip has no length." });
    expect(await asset()).toMatchObject({ describeStatus: "failed", describeError: "The clip has no length." });
  });

  it("ignores a job that is not the asset's current one", async () => {
    await optimizeAlphaClip();
    const row = await asset();
    const res = await signed(frames, "http://localhost/api/media/frames", { jobId: "22222222-2222-4222-8222-222222222222", assetId: row.id, ok: true });
    expect(res.status).toBe(404);
  });
});

describe("tags", () => {
  it("puts the project first, lowercases and dedupes the AI's tags", () => {
    expect(tagsFor("Cider Stand", { title: "", description: "", activity: ["Crowd", "crowd ", "POURING  cider"], shot: ["POV"], setting: ["Indoor"] })).toEqual([
      "Cider Stand",
      "crowd",
      "pouring cider",
      "pov",
      "indoor",
    ]);
  });
});
