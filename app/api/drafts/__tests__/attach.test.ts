import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
});

/**
 * The attach route runs (in order):
 *   1. select draft       → returns [draft]
 *   2. select asset       → returns [asset]
 *   3. select draft_assets → existing attachments
 *   4. insert draft_assets
 *   5. (if fully attached) update drafts; insert events
 *
 * We feed a FIFO queue of select results so the test can describe the
 * sequence inline.
 */

const selectQueue: unknown[][] = [];
let insertedRows: unknown[] = [];
let lastInsertValues: unknown = null;
const updateCalls: { patch: unknown }[] = [];

const dbMock = {
  select(_cols?: unknown) {
    return {
      from(_table: unknown) {
        return {
          where(_cond: unknown) {
            const next = selectQueue.shift() ?? [];
            return {
              limit: () => Promise.resolve(next),
              orderBy: () => Promise.resolve(next),
              then: (
                onfulfilled?: (v: unknown[]) => unknown,
                onrejected?: (e: unknown) => unknown,
              ) => Promise.resolve(next).then(onfulfilled, onrejected),
            };
          },
        };
      },
    };
  },
  insert(_table: unknown) {
    return {
      values(values: unknown) {
        lastInsertValues = values;
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
        updateCalls.push({ patch });
        return { where: () => Promise.resolve() };
      },
    };
  },
};

vi.mock("@/lib/db", () => ({ db: dbMock, schema: {} }));
vi.mock("@/lib/db/schema", () => ({
  drafts: { _name: "drafts", id: "id", brandId: "brand_id", format: "format", status: "status" },
  draftAssets: {
    _name: "draft_assets",
    draftId: "draft_id",
    assetId: "asset_id",
    slotIndex: "slot_index",
    role: "role",
  },
  assets: { _name: "assets", id: "id", brandId: "brand_id" },
  events: { _name: "events" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
}));

const { POST } = await import("../[id]/attach/route");

function req(url: string, body: unknown) {
  const r = new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const parsed = new URL(url);
  Object.defineProperty(r, "nextUrl", {
    value: { searchParams: parsed.searchParams },
    configurable: true,
  });
  return r as unknown as import("next/server").NextRequest;
}

const DRAFT_ID = "33333333-3333-3333-3333-333333333333";
const ASSET_ID = "44444444-4444-4444-4444-444444444444";
const ASSET2 = "55555555-5555-5555-5555-555555555555";
const BRAND_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  selectQueue.length = 0;
  insertedRows = [];
  lastInsertValues = null;
  updateCalls.length = 0;
});

describe("POST /api/drafts/[id]/attach", () => {
  it("rejects invalid draft id", async () => {
    const res = await POST(req(`http://localhost/api/drafts/bogus/attach`, {}), {
      params: Promise.resolve({ id: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid body", async () => {
    const res = await POST(
      req(`http://localhost/api/drafts/${DRAFT_ID}/attach`, { notAnAsset: 1 }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when draft missing", async () => {
    selectQueue.push([]); // draft lookup empty
    const res = await POST(
      req(`http://localhost/api/drafts/${DRAFT_ID}/attach`, {
        assetId: ASSET_ID,
      }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects when asset belongs to a different brand", async () => {
    selectQueue.push([
      { id: DRAFT_ID, brandId: BRAND_ID, format: "reel", status: "awaiting_assets" },
    ]);
    selectQueue.push([{ id: ASSET_ID, brandId: "other-brand-id" }]);
    const res = await POST(
      req(`http://localhost/api/drafts/${DRAFT_ID}/attach`, {
        assetId: ASSET_ID,
      }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(422);
  });

  it("rejects when slot already occupied by a different asset", async () => {
    selectQueue.push([
      { id: DRAFT_ID, brandId: BRAND_ID, format: "carousel", status: "awaiting_assets" },
    ]);
    selectQueue.push([{ id: ASSET_ID, brandId: BRAND_ID }]);
    selectQueue.push([
      { slotIndex: 0, role: "primary", assetId: "other-asset" },
    ]);
    const res = await POST(
      req(`http://localhost/api/drafts/${DRAFT_ID}/attach`, {
        assetId: ASSET_ID,
        slotIndex: 0,
      }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.error).toBe("slot_occupied");
  });

  it("transitions reel draft awaiting_assets→awaiting_final_review when primary attached", async () => {
    selectQueue.push([
      { id: DRAFT_ID, brandId: BRAND_ID, format: "reel", status: "awaiting_assets" },
    ]);
    selectQueue.push([{ id: ASSET_ID, brandId: BRAND_ID }]);
    selectQueue.push([]); // no existing attachments
    const res = await POST(
      req(`http://localhost/api/drafts/${DRAFT_ID}/attach`, {
        assetId: ASSET_ID,
        slotIndex: 0,
        role: "primary",
      }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.transitioned).toBe(true);
    expect(updateCalls[0]).toMatchObject({
      patch: { status: "awaiting_final_review" },
    });
  });

  it("does not transition carousel when fewer than 2 slots filled", async () => {
    selectQueue.push([
      { id: DRAFT_ID, brandId: BRAND_ID, format: "carousel", status: "awaiting_assets" },
    ]);
    selectQueue.push([{ id: ASSET_ID, brandId: BRAND_ID }]);
    selectQueue.push([]); // no existing
    const res = await POST(
      req(`http://localhost/api/drafts/${DRAFT_ID}/attach`, {
        assetId: ASSET_ID,
        slotIndex: 0,
        role: "primary",
      }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.transitioned).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  it("transitions carousel when adding the 2nd slot", async () => {
    selectQueue.push([
      { id: DRAFT_ID, brandId: BRAND_ID, format: "carousel", status: "awaiting_assets" },
    ]);
    selectQueue.push([{ id: ASSET2, brandId: BRAND_ID }]);
    // existing has slot 0 already filled with a different asset
    selectQueue.push([
      { slotIndex: 0, role: "primary", assetId: "first-asset" },
    ]);
    const res = await POST(
      req(`http://localhost/api/drafts/${DRAFT_ID}/attach`, {
        assetId: ASSET2,
        slotIndex: 1,
        role: "primary",
      }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.transitioned).toBe(true);
    expect(j.attachedCount).toBe(2);
  });
});
