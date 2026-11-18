import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
});
import {
  publishDuePosts,
  requeueFailedPosts,
  type ContainerPoller,
  type ContainerPublisher,
} from "../publish";
import type { Publisher } from "@/lib/publishing";
import { makeFakeDb, type FakeDB } from "./_helpers";
import { onPostPublished } from "../published-hooks";

function mkPublisher(overrides: Partial<Publisher> = {}): Publisher {
  return {
    connect: vi.fn(),
    publish: vi.fn(),
    fetchAnalytics: vi.fn(),
    refreshToken: vi.fn(),
    ...overrides,
  } as Publisher;
}

interface BuildOpts {
  postStatus?: "queued" | "publishing" | "failed";
  containerId?: string | null;
  publishAttempts?: number;
  lastErrorAt?: Date | null;
}

function buildDb(opts: BuildOpts = {}): FakeDB {
  const db = makeFakeDb({
    posts: [
      {
        id: "p1",
        draftId: "d1",
        brandId: "b1",
        channel: "instagram",
        status: opts.postStatus ?? "queued",
        scheduledFor: new Date(Date.now() - 60_000),
        externalContainerId: opts.containerId ?? null,
        publishAttempts: opts.publishAttempts ?? 0,
        lastErrorAt: opts.lastErrorAt ?? null,
        updatedAt: new Date(),
      },
    ],
    drafts: [
      {
        id: "d1",
        format: "reel",
        caption: "hello world",
      },
    ],
    draft_assets: [],
    assets: [],
    channel_connections: [
      {
        id: "cc1",
        brandId: "b1",
        channel: "instagram",
        accessToken: "tok",
        externalAccountId: "ig123",
        metaJson: { igBusinessId: "ig123" },
      },
    ],
    events: [],
  });
  return db;
}

describe("publishDuePosts — queued happy path", () => {
  it("marks post published when publisher returns a final result", async () => {
    const db = buildDb();
    const publisher = mkPublisher({
      publish: vi.fn().mockResolvedValue({
        externalId: "ig_media_1",
        url: "https://instagram.com/p/abc",
      }),
    });

    const result = await publishDuePosts({
      db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
      getPublisherFor: () => publisher,
    });

    expect(result.published).toBe(1);
    expect(result.pending).toBe(0);
    expect(result.failed).toBe(0);
    const post = db.store.get("posts")?.[0]!;
    expect(post.status).toBe("published");
    expect(post.externalPostId).toBe("ig_media_1");
    expect(post.externalUrl).toBe("https://instagram.com/p/abc");
    const events = db.store.get("events") ?? [];
    expect(events.some((e) => e.toStatus === "published")).toBe(true);
  });
});

describe("publishDuePosts — long-running IG Reel container", () => {
  it("publisher returns pending → post stays publishing with container id", async () => {
    const db = buildDb();
    const publisher = mkPublisher({
      publish: vi.fn().mockResolvedValue({
        externalId: "",
        url: "",
        pending: true,
        containerId: "container_xyz",
      }),
    });
    const result = await publishDuePosts({
      db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
      getPublisherFor: () => publisher,
    });
    expect(result.pending).toBe(1);
    const post = db.store.get("posts")?.[0]!;
    expect(post.status).toBe("publishing");
    expect(post.externalContainerId).toBe("container_xyz");
  });

  it("next cycle: IN_PROGRESS leaves it pending", async () => {
    const db = buildDb({
      postStatus: "publishing",
      containerId: "container_xyz",
    });
    const pollContainer: ContainerPoller = vi
      .fn()
      .mockResolvedValue("IN_PROGRESS");
    const publishContainer: ContainerPublisher = vi.fn();
    const result = await publishDuePosts({
      db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
      pollContainer,
      publishContainer,
    });
    expect(result.pending).toBe(1);
    expect(publishContainer).not.toHaveBeenCalled();
    expect(db.store.get("posts")?.[0]?.status).toBe("publishing");
  });

  it("next cycle: FINISHED triggers media_publish and marks published", async () => {
    const db = buildDb({
      postStatus: "publishing",
      containerId: "container_xyz",
    });
    const pollContainer: ContainerPoller = vi
      .fn()
      .mockResolvedValue("FINISHED");
    const publishContainer: ContainerPublisher = vi.fn().mockResolvedValue({
      mediaId: "ig_media_99",
      permalink: "https://instagram.com/p/xyz",
    });
    const result = await publishDuePosts({
      db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
      pollContainer,
      publishContainer,
    });
    expect(result.published).toBe(1);
    expect(publishContainer).toHaveBeenCalledOnce();
    const post = db.store.get("posts")?.[0]!;
    expect(post.status).toBe("published");
    expect(post.externalPostId).toBe("ig_media_99");
  });

  it("ERROR status marks failed", async () => {
    const db = buildDb({
      postStatus: "publishing",
      containerId: "container_xyz",
    });
    const pollContainer: ContainerPoller = vi
      .fn()
      .mockResolvedValue("ERROR");
    const result = await publishDuePosts({
      db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
      pollContainer,
      publishContainer: vi.fn(),
    });
    expect(result.failed).toBe(1);
    expect(db.store.get("posts")?.[0]?.status).toBe("failed");
  });
});

describe("publishDuePosts — failure + retry semantics", () => {
  it("publisher throw → status=failed, attempts++", async () => {
    const db = buildDb();
    const publisher = mkPublisher({
      publish: vi.fn().mockRejectedValue(new Error("graph 500")),
    });
    const result = await publishDuePosts({
      db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
      getPublisherFor: () => publisher,
    });
    expect(result.failed).toBe(1);
    const post = db.store.get("posts")?.[0]!;
    expect(post.status).toBe("failed");
    expect(post.publishAttempts).toBe(1);
    expect(post.publishError).toBe("graph 500");
  });
});

describe("requeueFailedPosts — exponential backoff 1m / 5m / 30m", () => {
  it("attempt 1 → requeue after 60s, not before", async () => {
    const justErrored = buildDb({
      postStatus: "failed",
      publishAttempts: 1,
      lastErrorAt: new Date(Date.now() - 10_000), // 10s ago
    });
    let result = await requeueFailedPosts({
      db: justErrored as unknown as NonNullable<Parameters<typeof requeueFailedPosts>[0]>["db"],
    });
    expect(result.requeued).toBe(0);

    const oneMinAgo = buildDb({
      postStatus: "failed",
      publishAttempts: 1,
      lastErrorAt: new Date(Date.now() - 65_000),
    });
    result = await requeueFailedPosts({
      db: oneMinAgo as unknown as NonNullable<Parameters<typeof requeueFailedPosts>[0]>["db"],
    });
    expect(result.requeued).toBe(1);
    expect(oneMinAgo.store.get("posts")?.[0]?.status).toBe("queued");
  });

  it("attempt 2 → waits 5m", async () => {
    const db = buildDb({
      postStatus: "failed",
      publishAttempts: 2,
      lastErrorAt: new Date(Date.now() - 4 * 60_000),
    });
    const r1 = await requeueFailedPosts({
      db: db as unknown as NonNullable<Parameters<typeof requeueFailedPosts>[0]>["db"],
    });
    expect(r1.requeued).toBe(0);

    const db2 = buildDb({
      postStatus: "failed",
      publishAttempts: 2,
      lastErrorAt: new Date(Date.now() - 6 * 60_000),
    });
    const r2 = await requeueFailedPosts({
      db: db2 as unknown as NonNullable<Parameters<typeof requeueFailedPosts>[0]>["db"],
    });
    expect(r2.requeued).toBe(1);
  });

  it("attempt 3 → waits 30m", async () => {
    const db = buildDb({
      postStatus: "failed",
      publishAttempts: 3,
      lastErrorAt: new Date(Date.now() - 31 * 60_000),
    });
    // attempts >= PUBLISH_MAX_ATTEMPTS (3) → never re-queue.
    const r = await requeueFailedPosts({
      db: db as unknown as NonNullable<Parameters<typeof requeueFailedPosts>[0]>["db"],
    });
    expect(r.requeued).toBe(0);
    expect(db.store.get("posts")?.[0]?.status).toBe("failed");
  });
});

describe("one post's failure does not stop the posts after it (other brands')", () => {
  /** Makes the first `n` writes to the database fail, as if one brand's rows could not be saved. */
  function failFirstUpdates(db: FakeDB, n: number): void {
    const real = db.update;
    let calls = 0;
    db.update = (table) => {
      if (calls++ < n) throw new Error("db write failed");
      return real(table);
    };
  }

  function twoBrands(status: "queued" | "failed"): FakeDB {
    const db = buildDb({ postStatus: status, publishAttempts: status === "failed" ? 1 : 0, lastErrorAt: status === "failed" ? new Date(Date.now() - 65_000) : null });
    const first = db.store.get("posts")![0]!;
    db.store.get("posts")!.push({ ...first, id: "p2", brandId: "b2" });
    return db;
  }

  it("publishDuePosts: a post that cannot even be marked failed is skipped, the next one publishes", async () => {
    const db = twoBrands("queued");
    failFirstUpdates(db, 2); // p1's status write, then p1's "mark failed" write
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const publisher = mkPublisher({ publish: vi.fn().mockResolvedValue({ externalId: "ig_media_2", url: "https://instagram.com/p/two" }) });

    const result = await publishDuePosts({
      db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
      getPublisherFor: () => publisher,
    });

    expect(result).toEqual({ processed: 2, published: 1, pending: 0, failed: 1 });
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("post=p1 brand=b1"));
    errors.mockRestore();
  });

  it("requeueFailedPosts: a failed write for one post still requeues the next", async () => {
    const db = twoBrands("failed");
    failFirstUpdates(db, 1);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await requeueFailedPosts({
      db: db as unknown as NonNullable<Parameters<typeof requeueFailedPosts>[0]>["db"],
    });

    expect(result.requeued).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("post=p1 brand=b1"));
    errors.mockRestore();
  });
});

describe("audit log", () => {
  it("every event carries the post's brand", async () => {
    const db = buildDb();
    const publisher = mkPublisher({ publish: vi.fn().mockResolvedValue({ externalId: "ig_media_1", url: "https://instagram.com/p/abc" }) });
    await publishDuePosts({
      db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
      getPublisherFor: () => publisher,
    });
    const events = db.store.get("events") ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.brandId === "b1")).toBe(true);
  });
});

describe("publishDuePosts — cloud-editor cuts and the published hook", () => {
  it("hands Instagram a fresh presigned link for an r2:// video, and the draft's cover offset", async () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "bucket";
    const db = buildDb();
    db.store.set("drafts", [{ id: "d1", format: "story", caption: "c", metaJson: { coverAtMs: 1000 } }]);
    // The fake db's join returns the draft_assets rows, so they carry the asset's columns too.
    db.store.set("draft_assets", [{ id: "a1", brandId: "b1", kind: "video", storageUrl: "r2://w/c/previews/cut.mp4", thumbnailUrl: null, mimeType: "video/mp4", width: null, height: null, durationSec: 15, sizeBytes: null, slotIndex: 0, role: "primary" }]);
    const publish = vi.fn().mockResolvedValue({ externalId: "", url: "", pending: true, containerId: "c1" });
    try {
      await publishDuePosts({
        db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
        getPublisherFor: () => mkPublisher({ publish }),
      });
    } finally {
      for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
    }
    const [post, assets] = publish.mock.calls[0];
    expect(post.format).toBe("story");
    expect(post.thumb_offset_ms).toBe(1000);
    expect(assets[0].storage_url).toMatch(/^https:\/\/.*w\/c\/previews\/cut\.mp4\?.*X-Amz-Signature=/);
  });

  it("tells the published listeners, with the post's link", async () => {
    const db = buildDb();
    const seen: Array<{ postId: string; externalUrl: string }> = [];
    const off = onPostPublished((p) => void seen.push({ postId: p.postId, externalUrl: p.externalUrl }));
    try {
      await publishDuePosts({
        db: db as unknown as NonNullable<Parameters<typeof publishDuePosts>[0]>["db"],
        getPublisherFor: () => mkPublisher({ publish: vi.fn().mockResolvedValue({ externalId: "m1", url: "https://instagram.com/p/x" }) }),
      });
    } finally {
      off();
    }
    expect(seen).toEqual([{ postId: "p1", externalUrl: "https://instagram.com/p/x" }]);
  });
});
