import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??= "0000000000000000000000000000000000000000000000000000000000000000";
});

const graph = vi.hoisted(() => ({ listInstagramMedia: vi.fn(), fetchInstagramPostInsights: vi.fn() }));
vi.mock("@/lib/publishing/meta-graph", () => graph);
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));

import { makeFakeDb } from "@/lib/pipelines/__tests__/_helpers";
import { syncAllInstagramMedia } from "../sync-instagram";

describe("syncAllInstagramMedia", () => {
  it("one brand's expired token does not stop the brands after it", async () => {
    const conn = { channel: "instagram", status: "connected", accessToken: "tok", externalAccountId: "ig1", metaJson: {} };
    const db = makeFakeDb({
      channel_connections: [
        { id: "c1", brandId: "b1", ...conn },
        { id: "c2", brandId: "b2", ...conn },
      ],
      brands: [{ id: "b1", slug: "one" }],
    });
    graph.listInstagramMedia.mockRejectedValueOnce(new Error("token expired")).mockResolvedValueOnce([]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const results = await syncAllInstagramMedia(db as never);

    expect(graph.listInstagramMedia).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { brandId: "b1", found: 0, imported: 0, failed: 0, error: "token expired" },
      { brandId: "b2", found: 0, imported: 0, failed: 0 },
    ]);
    errors.mockRestore();
  });
});
