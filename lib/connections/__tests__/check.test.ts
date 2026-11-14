import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
  return { db: null as unknown };
});

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  const { makeFakeDb } = await import("@/lib/pipelines/__tests__/_helpers");
  const row = { channel: "instagram", status: "connected", accessToken: "tok", externalAccountId: "ig", metaJson: {} };
  // The joined shape `loadRows` selects: the connection plus its brand's name and slug.
  state.db = makeFakeDb({
    channel_connections: [
      { row: { id: "c1", brandId: "b1", ...row }, name: "One", slug: "one" },
      { row: { id: "c2", brandId: "b2", ...row }, name: "Two", slug: "two" },
    ],
  });
  return { ...actual, db: state.db };
});

import type { FakeDB } from "@/lib/pipelines/__tests__/_helpers";
import { checkConnections } from "../check";

describe("checkConnections", () => {
  it("a failed write for one connection does not stop the connections after it", async () => {
    const db = state.db as FakeDB;
    const real = db.update;
    let calls = 0;
    db.update = (table) => {
      if (calls++ === 0) throw new Error("db write failed");
      return real(table);
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ username: "acct" }), { status: 200 }));

    const results = await checkConnections(fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(results.map((r) => [r.brandId, r.status])).toEqual([
      ["b1", "connected"],
      ["b2", "connected"],
    ]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("brand=b1"));
    errors.mockRestore();
  });
});
