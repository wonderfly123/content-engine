/**
 * Tests for /api/posts and /api/posts/[id]/schedule.
 *
 * The DB is faked through a thin chain-mock similar to the assets test —
 * we only model the call shapes that the routes use.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface FakeRow {
  [k: string]: unknown;
}

// State used by the chain mock.
let nextSelectRows: FakeRow[] = [];
let selectQueue: FakeRow[][] = [];
let insertedPosts: FakeRow[] = [];
let updatedDrafts: FakeRow[] = [];
let recordedEvents: FakeRow[] = [];

const dbMock = {
  select() {
    return {
      from() {
        return this;
      },
      innerJoin() {
        return this;
      },
      leftJoin() {
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      limit() {
        const rows = selectQueue.length ? selectQueue.shift()! : nextSelectRows;
        return Promise.resolve(rows);
      },
      then(onfulfilled?: (v: unknown[]) => unknown) {
        const rows = selectQueue.length ? selectQueue.shift()! : nextSelectRows;
        return Promise.resolve(rows).then(onfulfilled);
      },
    };
  },
  insert(_t: unknown) {
    return {
      values(v: FakeRow) {
        insertedPosts.push(v);
        return {
          returning() {
            return Promise.resolve([{ id: "new-post-id", ...v }]);
          },
        };
      },
    };
  },
  update(_t: unknown) {
    return {
      set(patch: FakeRow) {
        updatedDrafts.push(patch);
        const chain = {
          where() {
            return chain;
          },
          returning() {
            return Promise.resolve([{ id: "updated-id", ...patch }]);
          },
          // some call sites await the where(...) directly without returning()
          then(onfulfilled?: (v: unknown) => unknown) {
            return Promise.resolve(undefined).then(onfulfilled);
          },
        };
        return chain;
      },
    };
  },
  delete(_t: unknown) {
    return {
      where() {
        return Promise.resolve();
      },
    };
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock, schema: {} }));
vi.mock("@/lib/db/schema", () => ({
  posts: { _name: "posts" },
  drafts: { _name: "drafts" },
  events: { _name: "events" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ _and: a }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  asc: (a: unknown) => ({ _asc: a }),
  desc: (a: unknown) => ({ _desc: a }),
  gte: (a: unknown, b: unknown) => ({ _gte: [a, b] }),
  lte: (a: unknown, b: unknown) => ({ _lte: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ _in: [a, b] }),
  sql: Object.assign((..._: unknown[]) => ({ _sql: true }), {
    raw: (s: string) => ({ _raw: s }),
  }),
}));

vi.mock("@/lib/pipelines/events", () => ({
  recordEvent: async (e: FakeRow) => {
    recordedEvents.push(e);
    return "evt-id";
  },
}));

const { GET: listGet } = await import("../route");
const { POST: schedulePost } = await import("../[id]/schedule/route");
const { PATCH: postPatch } = await import("../[id]/route");

function makeReq(url: string, init?: RequestInit) {
  const r = new Request(url, init);
  const parsed = new URL(url);
  Object.defineProperty(r, "nextUrl", {
    value: { searchParams: parsed.searchParams },
    configurable: true,
  });
  return r as unknown as import("next/server").NextRequest;
}

const BRAND = "11111111-1111-1111-1111-111111111111";
const DRAFT = "22222222-2222-2222-2222-222222222222";
const POST = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  nextSelectRows = [];
  selectQueue = [];
  insertedPosts = [];
  updatedDrafts = [];
  recordedEvents = [];
});

describe("GET /api/posts", () => {
  it("rejects missing brandId", async () => {
    const res = await listGet(makeReq("http://localhost/api/posts"));
    expect(res.status).toBe(400);
  });

  it("returns rows for a valid brand id", async () => {
    nextSelectRows = [
      { id: POST, brandId: BRAND, channel: "instagram", format: "reel" },
    ];
    const res = await listGet(
      makeReq(`http://localhost/api/posts?brandId=${BRAND}`),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { posts: Array<{ id: string }> } };
    expect(json.data.posts).toHaveLength(1);
    expect(json.data.posts[0]!.id).toBe(POST);
  });

  it("filters by status + channel", async () => {
    nextSelectRows = [];
    const res = await listGet(
      makeReq(
        `http://localhost/api/posts?brandId=${BRAND}&status=queued&channel=instagram`,
      ),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/posts/[id]/schedule", () => {
  it("schedules: inserts post, transitions draft, records events", async () => {
    selectQueue = [
      // draft lookup
      [
        {
          id: DRAFT,
          brandId: BRAND,
          channel: "instagram",
          status: "awaiting_final_review",
        },
      ],
    ];
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await schedulePost(
      makeReq(`http://localhost/api/posts/${DRAFT}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledFor: future }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: DRAFT }) },
    );
    expect(res.status).toBe(201);
    expect(insertedPosts).toHaveLength(1);
    expect(insertedPosts[0]!.status).toBe("queued");
    expect(insertedPosts[0]!.draftId).toBe(DRAFT);
    expect(updatedDrafts[0]!.status).toBe("scheduled");
    // Two events: draft transition + post created.
    expect(recordedEvents).toHaveLength(2);
    expect(recordedEvents[0]!.entityType).toBe("draft");
    expect(recordedEvents[0]!.toStatus).toBe("scheduled");
    expect(recordedEvents[1]!.entityType).toBe("post");
  });

  it("rejects scheduling from an illegal state", async () => {
    selectQueue = [
      [
        {
          id: DRAFT,
          brandId: BRAND,
          channel: "instagram",
          status: "pending_review",
        },
      ],
    ];
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await schedulePost(
      makeReq(`http://localhost/api/posts/${DRAFT}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledFor: future }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: DRAFT }) },
    );
    expect(res.status).toBe(409);
  });

  it("rejects past target dates", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await schedulePost(
      makeReq(`http://localhost/api/posts/${DRAFT}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledFor: past }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: DRAFT }) },
    );
    expect(res.status).toBe(422);
  });
});

describe("PATCH /api/posts/[id]", () => {
  it("rejects non-queued posts", async () => {
    selectQueue = [[{ id: POST, status: "published" }]];
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await postPatch(
      makeReq(`http://localhost/api/posts/${POST}`, {
        method: "PATCH",
        body: JSON.stringify({ scheduledFor: future }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: POST }) },
    );
    expect(res.status).toBe(409);
  });

  it("rejects past target", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await postPatch(
      makeReq(`http://localhost/api/posts/${POST}`, {
        method: "PATCH",
        body: JSON.stringify({ scheduledFor: past }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: POST }) },
    );
    expect(res.status).toBe(422);
  });
});
