import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- Mock @/lib/db -------------------------------------------------------
// A tiny fluent chain that records the last operation and returns canned data.
type DbCall =
  | { op: "select-assets"; where?: unknown; result: unknown[] }
  | { op: "insert-asset"; values?: unknown; result: unknown[] }
  | { op: "insert-draft-asset"; values?: unknown; result: unknown[] }
  | { op: "update-draft"; result: unknown[] };

let dbCalls: DbCall[] = [];
let nextSelectResult: unknown[] = [];
let nextInsertAssetResult: unknown[] = [];
let nextSelectDraftResult: unknown[] = [];
let nextSelectDraftAssetsResult: unknown[] = [];
let nextSelectUsageResult: unknown[] = [];

const dbMock = {
  // SELECT … FROM <table> …
  select(_cols?: unknown) {
    return {
      from(table: { _name?: string } | unknown) {
        // We can't easily tell tables apart by reference inside the mock;
        // rely on call order via the queued results.
        return {
          where(_w: unknown) {
            return {
              orderBy() {
                const result = nextSelectResult;
                dbCalls.push({ op: "select-assets", result });
                return Promise.resolve(result);
              },
              // resolve directly for non-orderBy queries
              then(
                onfulfilled?: (v: unknown[]) => unknown,
                onrejected?: (e: unknown) => unknown,
              ) {
                const result =
                  table && (table as { _name?: string })._name === "drafts"
                    ? nextSelectDraftResult
                    : nextSelectDraftAssetsResult;
                return Promise.resolve(result).then(onfulfilled, onrejected);
              },
              groupBy() {
                return Promise.resolve(nextSelectUsageResult);
              },
              innerJoin() {
                return { where: () => Promise.resolve([]) };
              },
            };
          },
        };
      },
    };
  },
  insert(_table: unknown) {
    return {
      values(values: unknown) {
        return {
          returning() {
            const result = nextInsertAssetResult;
            dbCalls.push({ op: "insert-asset", values, result });
            return Promise.resolve(result);
          },
          then(onfulfilled?: () => unknown) {
            dbCalls.push({ op: "insert-draft-asset", values, result: [] });
            return Promise.resolve(undefined).then(onfulfilled);
          },
        };
      },
    };
  },
  update(_table: unknown) {
    return {
      set() {
        return {
          where() {
            const result: unknown[] = [];
            dbCalls.push({ op: "update-draft", result });
            return Promise.resolve(result);
          },
        };
      },
    };
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock, schema: {} }));
vi.mock("@/lib/db/schema", () => ({
  assets: { _name: "assets", id: "id", brandId: "brand_id", kind: "kind", archived: "archived", tags: "tags", label: "label", createdAt: "created_at", $inferInsert: {} },
  draftAssets: { _name: "draft_assets", draftId: "draft_id", assetId: "asset_id", slotIndex: "slot_index", role: "role" },
  drafts: { _name: "drafts", id: "id", status: "status", format: "format" },
}));

// drizzle-orm helpers used by the route — return simple sentinel objects
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  desc: (a: unknown) => ({ _desc: a }),
  ilike: (a: unknown, b: unknown) => ({ _ilike: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ _inArray: [a, b] }),
  sql: Object.assign((..._: unknown[]) => ({ _sql: true }), {
    raw: (s: string) => ({ _raw: s }),
  }),
}));

// Mock probe and thumbnail to avoid filesystem + network.
const probeUrlMock = vi.fn();
vi.mock("@/lib/assets/probe", () => ({
  probeUrl: (url: string) => probeUrlMock(url),
}));
vi.mock("@/lib/assets/thumbnail", () => ({
  generateThumbnail: vi.fn(async () => ({ url: "https://blob/thumb.jpg" })),
}));

// Now import the route handlers (after mocks installed).
const { GET, POST } = await import("../route");

function makeRequest(url: string, init?: RequestInit) {
  const req = new Request(url, init);
  // Attach a minimal nextUrl shim — the route only reads searchParams.
  const parsed = new URL(url);
  Object.defineProperty(req, "nextUrl", {
    value: { searchParams: parsed.searchParams },
    configurable: true,
  });
  return req as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  dbCalls = [];
  nextSelectResult = [];
  nextInsertAssetResult = [];
  nextSelectDraftResult = [];
  nextSelectDraftAssetsResult = [];
  nextSelectUsageResult = [];
  probeUrlMock.mockReset();
});

const BRAND_ID = "11111111-1111-1111-1111-111111111111";
const DRAFT_ID = "22222222-2222-2222-2222-222222222222";

describe("GET /api/assets", () => {
  it("rejects invalid query (missing brandId)", async () => {
    const res = await GET(makeRequest("http://localhost/api/assets"));
    expect(res.status).toBe(400);
  });

  it("returns assets list for a valid brandId", async () => {
    nextSelectResult = [
      {
        id: "a-1",
        brandId: BRAND_ID,
        kind: "image",
        archived: false,
        tags: [],
      },
    ];
    nextSelectUsageResult = [{ assetId: "a-1", count: 2 }];
    const res = await GET(
      makeRequest(`http://localhost/api/assets?brandId=${BRAND_ID}`),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { assets: Array<{ usageCount: number }> };
    expect(json.assets).toHaveLength(1);
    expect(json.assets[0].usageCount).toBe(2);
  });

  it("accepts kind filter", async () => {
    nextSelectResult = [];
    const res = await GET(
      makeRequest(
        `http://localhost/api/assets?brandId=${BRAND_ID}&kind=video&archived=true`,
      ),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/assets", () => {
  it("happy path: probes, validates, inserts asset row, returns 201", async () => {
    probeUrlMock.mockResolvedValue({
      width: 1080,
      height: 1080,
      sizeBytes: 100_000,
      hasAudio: false,
      ratio: 1,
    });
    nextInsertAssetResult = [
      {
        id: "a-new",
        brandId: BRAND_ID,
        kind: "image",
        label: "x",
        tags: [],
      },
    ];
    const res = await POST(
      makeRequest("http://localhost/api/assets", {
        method: "POST",
        body: JSON.stringify({
          brandId: BRAND_ID,
          blobUrl: "https://blob.example/a.jpg",
          kind: "image",
          label: "x",
          mimeType: "image/jpeg",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { asset: { id: string } };
    expect(body.asset.id).toBe("a-new");
  });

  it("rejects invalid Reel (3% off ratio) with 422", async () => {
    probeUrlMock.mockResolvedValue({
      width: 1080,
      height: 1700, // ratio 0.635 — way off from 0.5625
      durationSec: 30,
      sizeBytes: 5_000_000,
      hasAudio: true,
      ratio: 1080 / 1700,
    });
    const res = await POST(
      makeRequest("http://localhost/api/assets", {
        method: "POST",
        body: JSON.stringify({
          brandId: BRAND_ID,
          blobUrl: "https://blob.example/r.mp4",
          kind: "video",
          mimeType: "video/mp4",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ratio_invalid");
  });

  it("validates body schema and rejects malformed input", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/assets", {
        method: "POST",
        body: JSON.stringify({ brandId: "not-a-uuid" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("passes draftId through to draft_assets insert", async () => {
    probeUrlMock.mockResolvedValue({
      width: 1080,
      height: 1080,
      sizeBytes: 100_000,
      hasAudio: false,
      ratio: 1,
    });
    nextInsertAssetResult = [
      { id: "a-attached", brandId: BRAND_ID, kind: "image" },
    ];
    // SELECT drafts to check status — return empty so transition skips.
    nextSelectDraftResult = [];
    const res = await POST(
      makeRequest("http://localhost/api/assets", {
        method: "POST",
        body: JSON.stringify({
          brandId: BRAND_ID,
          draftId: DRAFT_ID,
          blobUrl: "https://blob.example/a.jpg",
          kind: "image",
          mimeType: "image/jpeg",
          slotIndex: 0,
          role: "primary",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { attached: boolean };
    expect(body.attached).toBe(true);
    expect(
      dbCalls.some((c) => c.op === "insert-draft-asset"),
    ).toBe(true);
  });
});
