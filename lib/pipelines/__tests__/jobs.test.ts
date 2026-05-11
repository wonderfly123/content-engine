import { describe, expect, it, vi } from "vitest";

// Provide a dummy DATABASE_URL so `lib/db/index.ts`'s top-level `neon()` call
// does not throw at import time. The fake DB is what the tests actually use.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
});
import {
  claimNextJob,
  completeJob,
  drainJobs,
  enqueueJob,
  failJob,
} from "../jobs";
import { schema } from "@/lib/db";
import { makeFakeDb } from "./_helpers";

describe("enqueueJob", () => {
  it("inserts a queued row with the given kind + payload", async () => {
    const db = makeFakeDb();
    const id = await enqueueJob(
      { kind: "research_pull", brandId: "b1", payload: { foo: 1 } },
      db as unknown as Parameters<typeof enqueueJob>[1],
    );
    const rows = db.store.get("jobs") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      kind: "research_pull",
      brandId: "b1",
      status: "queued",
    });
    expect((rows[0]?.payloadJson as Record<string, unknown>).foo).toBe(1);
  });
});

describe("claimNextJob", () => {
  it("returns null when no rows are due", async () => {
    const db = makeFakeDb();
    db.exec.mockResolvedValueOnce({ rows: [] });
    const claimed = await claimNextJob(
      undefined,
      db as unknown as Parameters<typeof claimNextJob>[1],
    );
    expect(claimed).toBeNull();
  });

  it("returns the claimed job shape when SQL returns one", async () => {
    const db = makeFakeDb();
    db.exec.mockResolvedValueOnce({
      rows: [
        {
          id: "j1",
          kind: "publish",
          brand_id: "b1",
          payload_json: { post_id: "p1" },
          attempts: 1,
        },
      ],
    });
    const claimed = await claimNextJob(
      "publish",
      db as unknown as Parameters<typeof claimNextJob>[1],
    );
    expect(claimed).toEqual({
      id: "j1",
      kind: "publish",
      brandId: "b1",
      payload: { post_id: "p1" },
      attempts: 1,
    });
  });
});

describe("completeJob + failJob", () => {
  it("completeJob flips status to done", async () => {
    const db = makeFakeDb({
      jobs: [{ id: "j1", status: "running", attempts: 1 }],
    });
    await completeJob(
      "j1",
      db as unknown as Parameters<typeof completeJob>[1],
    );
    expect(db.store.get("jobs")?.[0]?.status).toBe("done");
  });

  it("failJob without retry leaves the row in failed", async () => {
    const db = makeFakeDb({
      jobs: [{ id: "j1", status: "running", attempts: 3 }],
    });
    const status = await failJob(
      "j1",
      "boom",
      {},
      db as unknown as Parameters<typeof failJob>[3],
    );
    expect(status).toBe("failed");
    expect(db.store.get("jobs")?.[0]?.status).toBe("failed");
    expect(db.store.get("jobs")?.[0]?.lastError).toBe("boom");
  });

  it("failJob with retry re-queues with backoff", async () => {
    const before = Date.now();
    const db = makeFakeDb({
      jobs: [{ id: "j1", status: "running", attempts: 1 }],
    });
    const status = await failJob(
      "j1",
      "transient",
      { retryDelaySeconds: 60, maxAttempts: 3 },
      db as unknown as Parameters<typeof failJob>[3],
    );
    expect(status).toBe("queued");
    const row = db.store.get("jobs")?.[0]!;
    expect(row.status).toBe("queued");
    const scheduled = row.scheduledFor as Date;
    expect(scheduled.getTime()).toBeGreaterThanOrEqual(before + 60 * 1000 - 50);
  });

  it("failJob caps retries at maxAttempts", async () => {
    const db = makeFakeDb({
      jobs: [{ id: "j1", status: "running", attempts: 3 }],
    });
    const status = await failJob(
      "j1",
      "give up",
      { retryDelaySeconds: 60, maxAttempts: 3 },
      db as unknown as Parameters<typeof failJob>[3],
    );
    expect(status).toBe("failed");
  });
});

describe("drainJobs", () => {
  it("runs the provided runner until the queue empties", async () => {
    const db = makeFakeDb();
    db.exec
      .mockResolvedValueOnce({
        rows: [{ id: "j1", kind: "publish", brand_id: null, payload_json: {}, attempts: 1 }],
      })
      .mockResolvedValueOnce({ rows: [] });
    // jobs table preload so completeJob has something to find.
    db.store.set("jobs", [{ id: "j1", status: "running", attempts: 1 }]);
    const runner = vi.fn().mockResolvedValue(undefined);
    const out = await drainJobs(runner, {
      db: db as unknown as NonNullable<Parameters<typeof drainJobs>[1]>["db"],
    });
    expect(out.processed).toBe(1);
    expect(out.failed).toBe(0);
  });
});

// Reference the schema import to keep linters quiet.
void schema;
