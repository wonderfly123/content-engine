import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
});

// ---- Mock @/lib/db -------------------------------------------------------
let selectResults: unknown[] = [];
let insertedRows: unknown[] = [];
let lastInsertValues: unknown = null;
const allInsertValues: unknown[] = [];
let updateCalls: unknown[] = [];
let lastWhereCond: unknown = null;

const dbMock = {
  select(_cols?: unknown) {
    return {
      from(_table: unknown) {
        return {
          where(cond: unknown) {
            lastWhereCond = cond;
            return {
              orderBy: () => Promise.resolve(selectResults),
              limit: () => Promise.resolve(selectResults),
              then: (
                onfulfilled?: (v: unknown[]) => unknown,
                onrejected?: (e: unknown) => unknown,
              ) => Promise.resolve(selectResults).then(onfulfilled, onrejected),
            };
          },
          orderBy: () => Promise.resolve(selectResults),
        };
      },
    };
  },
  insert(_table: unknown) {
    return {
      values(values: unknown) {
        lastInsertValues = values;
        allInsertValues.push(values);
        return {
          returning: () => Promise.resolve(insertedRows),
          then: (onfulfilled?: () => unknown) =>
            Promise.resolve(undefined).then(onfulfilled),
        };
      },
    };
  },
  update(_table: unknown) {
    return {
      set(patch: unknown) {
        return {
          where(cond: unknown) {
            updateCalls.push({ patch, cond });
            return Promise.resolve();
          },
        };
      },
    };
  },
  delete(_table: unknown) {
    return { where: () => Promise.resolve() };
  },
};

vi.mock("@/lib/db", () => ({
  db: dbMock,
  schema: {
    briefs: { _name: "briefs", id: "id" },
    events: { _name: "events" },
    drafts: { _name: "drafts", id: "id" },
    brands: { _name: "brands", id: "id" },
    jobs: { _name: "jobs", id: "id" },
  },
}));
vi.mock("@/lib/db/schema", () => ({
  briefs: { _name: "briefs", id: "id", brandId: "brand_id", status: "status", channel: "channel", createdAt: "created_at" },
  events: { _name: "events" },
  drafts: { _name: "drafts", id: "id", briefId: "brief_id", status: "status" },
  brands: { _name: "brands", id: "id" },
  jobs: { _name: "jobs", id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  desc: (a: unknown) => ({ _desc: a }),
  gte: (a: unknown, b: unknown) => ({ _gte: [a, b] }),
  asc: (a: unknown) => ({ _asc: a }),
  lte: (a: unknown, b: unknown) => ({ _lte: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ _inArray: [a, b] }),
  isNotNull: (a: unknown) => ({ _isNotNull: a }),
  sql: Object.assign((..._: unknown[]) => ({ _sql: true }), {
    raw: (s: string) => ({ _raw: s }),
  }),
}));

// Track pipeline call
const approveAndGen = vi.fn();
vi.mock("@/lib/pipelines/drafts", () => ({
  approveBriefAndGenerateDraft: (id: string, opts?: unknown) =>
    approveAndGen(id, opts),
}));

const { GET, POST } = await import("../route");
const rejectRoute = await import("../[id]/reject/route");
const approveRoute = await import("../[id]/approve/route");
const batchRoute = await import("../batch/route");

function makeRequest(url: string, init?: RequestInit) {
  const req = new Request(url, init);
  const parsed = new URL(url);
  Object.defineProperty(req, "nextUrl", {
    value: { searchParams: parsed.searchParams },
    configurable: true,
  });
  return req as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  selectResults = [];
  insertedRows = [];
  lastInsertValues = null;
  allInsertValues.length = 0;
  updateCalls = [];
  lastWhereCond = null;
  approveAndGen.mockReset();
});

const BRAND_ID = "11111111-1111-1111-1111-111111111111";
const BRIEF_ID = "22222222-2222-2222-2222-222222222222";

describe("GET /api/briefs", () => {
  it("rejects invalid status filter", async () => {
    const res = await GET(
      makeRequest(`http://localhost/api/briefs?status=bogus`),
    );
    expect(res.status).toBe(400);
  });

  it("returns rows for valid query", async () => {
    selectResults = [{ id: BRIEF_ID, title: "x", status: "pending_review" }];
    const res = await GET(
      makeRequest(`http://localhost/api/briefs?brandId=${BRAND_ID}`),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.briefs).toHaveLength(1);
  });

  it("filters by channel when given", async () => {
    selectResults = [];
    const res = await GET(
      makeRequest(
        `http://localhost/api/briefs?brandId=${BRAND_ID}&channel=instagram`,
      ),
    );
    expect(res.status).toBe(200);
    // Where condition should have been built (covered by lastWhereCond being set).
    expect(lastWhereCond).not.toBeNull();
  });
});

describe("POST /api/briefs", () => {
  it("rejects invalid body", async () => {
    const res = await POST(
      makeRequest(`http://localhost/api/briefs`, {
        method: "POST",
        body: JSON.stringify({ brandId: "nope" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("inserts a brief with pending_review status", async () => {
    insertedRows = [
      { id: BRIEF_ID, brandId: BRAND_ID, status: "pending_review" },
    ];
    const res = await POST(
      makeRequest(`http://localhost/api/briefs`, {
        method: "POST",
        body: JSON.stringify({
          brandId: BRAND_ID,
          channel: "instagram",
          format: "reel",
          title: "Test brief",
        }),
      }),
    );
    expect(res.status).toBe(201);
    // First insert is the brief itself; second is the audit event.
    expect(allInsertValues[0]).toMatchObject({
      brandId: BRAND_ID,
      status: "pending_review",
    });
  });
});

describe("POST /api/briefs/[id]/approve", () => {
  it("returns 400 on invalid id", async () => {
    const res = await approveRoute.POST(
      makeRequest(`http://localhost/api/briefs/bogus/approve`, { method: "POST" }),
      { params: Promise.resolve({ id: "bogus" }) },
    );
    expect(res.status).toBe(400);
  });

  it("calls approveBriefAndGenerateDraft", async () => {
    approveAndGen.mockResolvedValue({
      draftId: "d1",
      briefId: BRIEF_ID,
      channel: "instagram",
      format: "reel",
    });
    const res = await approveRoute.POST(
      makeRequest(`http://localhost/api/briefs/${BRIEF_ID}/approve`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: BRIEF_ID }) },
    );
    expect(res.status).toBe(200);
    expect(approveAndGen).toHaveBeenCalledWith(BRIEF_ID, { actor: "user" });
    const json = await res.json();
    expect(json.draftId).toBe("d1");
  });

  it("returns 422 when pipeline throws", async () => {
    approveAndGen.mockRejectedValue(new Error("Illegal transition"));
    const res = await approveRoute.POST(
      makeRequest(`http://localhost/api/briefs/${BRIEF_ID}/approve`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: BRIEF_ID }) },
    );
    expect(res.status).toBe(422);
  });
});

describe("POST /api/briefs/[id]/reject", () => {
  it("requires a reason", async () => {
    const res = await rejectRoute.POST(
      makeRequest(`http://localhost/api/briefs/${BRIEF_ID}/reject`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: BRIEF_ID }) },
    );
    expect(res.status).toBe(400);
  });

  it("stores rejection_reason on the brief", async () => {
    selectResults = [{ status: "pending_review" }];
    const res = await rejectRoute.POST(
      makeRequest(`http://localhost/api/briefs/${BRIEF_ID}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "Off voice" }),
      }),
      { params: Promise.resolve({ id: BRIEF_ID }) },
    );
    expect(res.status).toBe(200);
    expect(updateCalls[0]).toMatchObject({
      patch: expect.objectContaining({
        status: "rejected",
        rejectionReason: "Off voice",
      }),
    });
  });
});

describe("POST /api/briefs/batch", () => {
  it("enqueues a brief_batch job", async () => {
    insertedRows = [{ id: "job-1" }];
    const res = await batchRoute.POST(
      makeRequest(`http://localhost/api/briefs/batch`, {
        method: "POST",
        body: JSON.stringify({ brandId: BRAND_ID }),
      }),
    );
    expect(res.status).toBe(202);
    expect(lastInsertValues).toMatchObject({
      kind: "brief_batch",
      brandId: BRAND_ID,
    });
  });
});
