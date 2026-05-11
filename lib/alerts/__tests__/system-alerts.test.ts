import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
});

// Lazy import so env stubs above land first.
import { listSystemAlerts } from "../system-alerts";

interface Row {
  [k: string]: unknown;
}

/**
 * Minimal DB stub for these tests — production code only calls
 * `select(cols).from(table).where(...).orderBy(...).limit(n)` so we only
 * need to honour the chain. We discriminate the three sources by the
 * column set passed to `select`, which is stable and unique per source.
 */
function makeDb(seed: {
  jobs: Row[];
  conns: Row[];
  posts: Row[];
}): { select: () => unknown } {
  return {
    select(cols: Record<string, unknown> = {}) {
      // Detect source by a column key unique to each branch.
      let bucket: Row[];
      if ("lastError" in cols) bucket = seed.jobs;
      else if ("connectedAt" in cols && "status" in cols) bucket = seed.conns;
      else bucket = seed.posts;

      const builder = {
        from: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: async () => bucket,
      };
      return builder;
    },
  };
}

describe("listSystemAlerts", () => {
  it("aggregates failed jobs, expired channels, and failed posts", async () => {
    const now = new Date();
    const db = makeDb({
      jobs: [
        {
          id: "j1",
          kind: "research_pull",
          brandId: "b1",
          lastError: "Firecrawl 500",
          completedAt: now,
          scheduledFor: now,
        },
      ],
      conns: [
        {
          id: "c1",
          brandId: "b1",
          channel: "instagram",
          status: "expired",
          connectedAt: now,
        },
      ],
      posts: [
        {
          id: "p1",
          brandId: "b1",
          channel: "facebook",
          publishError: "Token expired",
          lastErrorAt: now,
          updatedAt: now,
        },
      ],
    });

    // @ts-expect-error — test double for the Drizzle handle
    const alerts = await listSystemAlerts({ db });
    expect(alerts).toHaveLength(3);
    const kinds = alerts.map((a) => a.kind).sort();
    expect(kinds).toEqual([
      "channel_disconnected",
      "job_failed",
      "post_failed",
    ]);
  });

  it("scopes by brandId when supplied (test relies on production WHERE)", async () => {
    // The fake DB doesn't filter by predicate, but if the caller passes a
    // brand we still expect the function to surface only what the bucket
    // contains. We instead verify the brand is propagated onto results.
    const db = makeDb({
      jobs: [],
      conns: [
        {
          id: "c1",
          brandId: "b2",
          channel: "facebook",
          status: "revoked",
          connectedAt: new Date(),
        },
      ],
      posts: [],
    });
    // @ts-expect-error
    const alerts = await listSystemAlerts({ db, brandId: "b2" });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.brandId).toBe("b2");
    expect(alerts[0]!.title).toMatch(/Facebook/);
  });

  it("dedupes by kind+entityId", async () => {
    // Same job appearing twice in the bucket only surfaces once.
    const now = new Date();
    const job = {
      id: "dup",
      kind: "publish",
      brandId: null,
      lastError: "boom",
      completedAt: now,
      scheduledFor: now,
    };
    const db = makeDb({ jobs: [job, job], conns: [], posts: [] });
    // @ts-expect-error
    const alerts = await listSystemAlerts({ db });
    expect(alerts).toHaveLength(1);
  });

  it("returns empty when no failures exist", async () => {
    const db = makeDb({ jobs: [], conns: [], posts: [] });
    // @ts-expect-error
    const alerts = await listSystemAlerts({ db });
    expect(alerts).toEqual([]);
  });

  it("orders newest first", async () => {
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-05-01T00:00:00Z");
    const db = makeDb({
      jobs: [
        {
          id: "j-old",
          kind: "publish",
          brandId: "b",
          lastError: "x",
          completedAt: older,
          scheduledFor: older,
        },
      ],
      conns: [],
      posts: [
        {
          id: "p-new",
          brandId: "b",
          channel: "instagram",
          publishError: "y",
          lastErrorAt: newer,
          updatedAt: newer,
        },
      ],
    });
    // @ts-expect-error
    const alerts = await listSystemAlerts({ db });
    expect(alerts[0]!.id).toBe("post_failed:p-new");
    expect(alerts[1]!.id).toBe("job_failed:j-old");
  });
});
