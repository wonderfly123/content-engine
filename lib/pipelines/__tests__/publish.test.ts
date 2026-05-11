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
