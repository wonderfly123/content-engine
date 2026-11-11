/**
 * Pipeline 5a — Publish (cron sweep, every 5 minutes). Section 6 of the spec.
 *
 * For each due post:
 *   - `queued` → call publisher.publish → either `published` (immediate) or
 *     `publishing` with `external_container_id` (long-running IG Reel).
 *   - `publishing` w/ container → poll Meta container status; finalize when
 *     FINISHED, mark failed when ERROR, leave alone when IN_PROGRESS.
 *   - Failures bump `publish_attempts`. After 3 attempts → terminal-failed.
 *     The jobs-retry cron re-queues failed posts with exponential backoff
 *     (1min / 5min / 30min from `last_error_at`) via `requeueFailedPosts`.
 *
 * CONCERN (flagged in report):
 *   The `Publisher` interface (Task 4) does not expose `pollContainer`. To
 *   honour the "never block in cron" rule for IG Reel encoding we need to
 *   poll Meta's `/{container_id}?fields=status_code` directly. We implement
 *   a dedicated `pollIgContainer` helper here that calls Graph API via fetch
 *   using the channel_connection token. This is a one-off bypass of the
 *   adapter pattern, scoped to container polling only. Follow-up: extend
 *   `Publisher` with `pollContainer(connection, containerId)` and remove
 *   this helper.
 */

import { and, eq, inArray, lte, lt, sql } from "drizzle-orm";
import { db as defaultDb, schema } from "@/lib/db";
import {
  getPublisher,
  type Publisher,
  type PublishResult,
  type Asset as PubAsset,
  type Post as PubPost,
} from "@/lib/publishing";
import {
  PUBLISH_MAX_ATTEMPTS,
  PUBLISH_RETRY_DELAYS_SECONDS,
  assertPostTransition,
} from "./state";
import { recordEvent } from "./events";

export type DbOrTx = typeof defaultDb;

/**
 * IG container status fetcher. Either the live Graph API (default) or an
 * injected stub for tests. Returning the raw `status_code` from Meta keeps
 * the caller honest about the three-state response.
 */
export type ContainerPoller = (args: {
  containerId: string;
  accessToken: string;
  graphVersion?: string;
}) => Promise<"FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED">;

export type ContainerPublisher = (args: {
  containerId: string;
  igUserId: string;
  accessToken: string;
  graphVersion?: string;
}) => Promise<{ mediaId: string; permalink?: string }>;

export interface PublishDueDeps {
  db?: DbOrTx;
  getPublisherFor?: (
    channel: "instagram" | "facebook",
  ) => Publisher;
  pollContainer?: ContainerPoller;
  publishContainer?: ContainerPublisher;
  now?: () => Date;
  /** Max posts processed per sweep. */
  limit?: number;
}

export interface PublishDueResult {
  processed: number;
  published: number;
  pending: number;
  failed: number;
}

/**
 * Main cron entrypoint. Picks up to `limit` due posts and advances each one
 * state machine step. Never blocks waiting for a container — pending IG
 * Reels are left in `publishing` and re-checked next cycle.
 */
export async function publishDuePosts(
  deps: PublishDueDeps = {},
): Promise<PublishDueResult> {
  const db = deps.db ?? defaultDb;
  const limit = deps.limit ?? 20;
  const now = deps.now ?? (() => new Date());

  const due = await db
    .select()
    .from(schema.posts)
    .where(
      and(
        inArray(schema.posts.status, ["queued", "publishing"]),
        lte(schema.posts.scheduledFor, now()),
      ),
    )
    .orderBy(schema.posts.scheduledFor)
    .limit(limit);

  let published = 0;
  let pending = 0;
  let failed = 0;

  for (const post of due) {
    try {
      if (post.status === "queued") {
        const result = await publishQueuedPost(post, deps);
        if (result === "published") published++;
        else if (result === "pending") pending++;
        else failed++;
      } else if (post.status === "publishing") {
        if (!post.externalContainerId) {
          // Stuck without a container id — treat as a soft failure.
          await markPostFailed(
            post,
            "publishing without external_container_id",
            deps,
          );
          failed++;
          continue;
        }
        const result = await finalizePublishingPost(post, deps);
        if (result === "published") published++;
        else if (result === "pending") pending++;
        else failed++;
      }
    } catch (err) {
      await markPostFailed(post, (err as Error).message, deps);
      failed++;
    }
  }

  return { processed: due.length, published, pending, failed };
}

type PostRow = typeof schema.posts.$inferSelect;

async function publishQueuedPost(
  post: PostRow,
  deps: PublishDueDeps,
): Promise<"published" | "pending" | "failed"> {
  const db = deps.db ?? defaultDb;
  const getPub = deps.getPublisherFor ?? getPublisher;

  // queued → publishing
  assertPostTransition(post.status, "publishing");
  await db
    .update(schema.posts)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(eq(schema.posts.id, post.id));
  await recordEvent(
    {
      entityType: "post",
      entityId: post.id,
      fromStatus: "queued",
      toStatus: "publishing",
    },
    db,
  );

  if (post.channel !== "instagram" && post.channel !== "facebook") {
    await markPostFailed(
      post,
      `unsupported channel ${post.channel}`,
      deps,
    );
    return "failed";
  }

  const publisher = getPub(post.channel);

  // Build adapter-shaped Post + Assets from the draft.
  const draft = await loadDraftWithAssets(db, post.draftId);
  const pubPost: PubPost = {
    id: post.id,
    brand_id: post.brandId,
    channel: post.channel,
    format: draft.format,
    caption: draft.caption,
    scheduled_for: post.scheduledFor.toISOString(),
    external_container_id: post.externalContainerId,
    trial: draft.trial,
  };
  const pubAssets: PubAsset[] = draft.assets.map((a) => ({
    id: a.id,
    brand_id: a.brandId,
    kind: a.kind,
    storage_url: a.storageUrl,
    thumbnail_url: a.thumbnailUrl,
    mime_type: a.mimeType ?? undefined,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    duration_sec: a.durationSec ?? undefined,
    size_bytes: a.sizeBytes ?? undefined,
    slot_index: a.slotIndex,
    role: a.role,
  }));

  let result: PublishResult;
  try {
    result = await publisher.publish(pubPost, pubAssets);
  } catch (err) {
    await markPostFailed(post, (err as Error).message, deps);
    return "failed";
  }

  if (result.pending && result.containerId) {
    await db
      .update(schema.posts)
      .set({
        externalContainerId: result.containerId,
        updatedAt: new Date(),
      })
      .where(eq(schema.posts.id, post.id));
    await recordEvent(
      {
        entityType: "post",
        entityId: post.id,
        toStatus: "publishing",
        note: `container=${result.containerId}`,
      },
      db,
    );
    return "pending";
  }

  await markPostPublished(post, result.externalId, result.url, deps);
  return "published";
}

async function finalizePublishingPost(
  post: PostRow,
  deps: PublishDueDeps,
): Promise<"published" | "pending" | "failed"> {
  const db = deps.db ?? defaultDb;
  const poll = deps.pollContainer ?? defaultPollContainer;
  const pub = deps.publishContainer ?? defaultPublishContainer;

  const conn = await db
    .select()
    .from(schema.channelConnections)
    .where(
      and(
        eq(schema.channelConnections.brandId, post.brandId),
        eq(schema.channelConnections.channel, post.channel),
      ),
    )
    .limit(1);
  const channel = conn[0];
  if (!channel) {
    await markPostFailed(
      post,
      `no channel_connection for brand=${post.brandId} channel=${post.channel}`,
      deps,
    );
    return "failed";
  }
  const igUserId =
    channel.metaJson.igBusinessId ?? channel.externalAccountId ?? "";

  const status = await poll({
    containerId: post.externalContainerId!,
    accessToken: channel.accessToken,
  });

  if (status === "IN_PROGRESS") {
    // Leave the row as-is; next cron cycle re-polls.
    return "pending";
  }
  if (status === "ERROR" || status === "EXPIRED") {
    await markPostFailed(
      post,
      `container ${post.externalContainerId} ${status.toLowerCase()}`,
      deps,
    );
    return "failed";
  }

  // FINISHED → media_publish.
  try {
    const published = await pub({
      containerId: post.externalContainerId!,
      igUserId,
      accessToken: channel.accessToken,
    });
    await markPostPublished(
      post,
      published.mediaId,
      published.permalink ?? "",
      deps,
    );
    return "published";
  } catch (err) {
    await markPostFailed(post, (err as Error).message, deps);
    return "failed";
  }
}

async function markPostPublished(
  post: PostRow,
  externalId: string,
  externalUrl: string,
  deps: PublishDueDeps,
): Promise<void> {
  const db = deps.db ?? defaultDb;
  await db
    .update(schema.posts)
    .set({
      status: "published",
      externalPostId: externalId,
      externalUrl,
      publishedAt: new Date(),
      publishError: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.posts.id, post.id));
  await recordEvent(
    {
      entityType: "post",
      entityId: post.id,
      fromStatus: post.status,
      toStatus: "published",
      note: `external_id=${externalId}`,
    },
    db,
  );
}

async function markPostFailed(
  post: PostRow,
  errorMessage: string,
  deps: PublishDueDeps,
): Promise<void> {
  const db = deps.db ?? defaultDb;
  const attempts = post.publishAttempts + 1;
  await db
    .update(schema.posts)
    .set({
      status: "failed",
      publishError: errorMessage,
      publishAttempts: attempts,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.posts.id, post.id));
  await recordEvent(
    {
      entityType: "post",
      entityId: post.id,
      fromStatus: post.status,
      toStatus: "failed",
      note: `attempt=${attempts} error=${errorMessage}`,
    },
    db,
  );
}

interface DraftWithAssets {
  format: typeof schema.drafts.$inferSelect.format;
  caption: string;
  /** Instagram trial Reel mode, from `drafts.meta_json.trialReel`. */
  trial: "manual" | "auto" | null;
  assets: Array<{
    id: string;
    brandId: string;
    kind: "video" | "image" | "audio" | "graphic";
    storageUrl: string;
    thumbnailUrl: string | null;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    durationSec: number | null;
    sizeBytes: number | null;
    slotIndex: number;
    role: "primary" | "cover" | "b_roll";
  }>;
}

async function loadDraftWithAssets(
  db: DbOrTx,
  draftId: string,
): Promise<DraftWithAssets> {
  const draftRows = await db
    .select({
      format: schema.drafts.format,
      caption: schema.drafts.caption,
      metaJson: schema.drafts.metaJson,
    })
    .from(schema.drafts)
    .where(eq(schema.drafts.id, draftId))
    .limit(1);
  const draft = draftRows[0];
  if (!draft) throw new Error(`Draft ${draftId} not found`);

  const assetRows = await db
    .select({
      id: schema.assets.id,
      brandId: schema.assets.brandId,
      kind: schema.assets.kind,
      storageUrl: schema.assets.storageUrl,
      thumbnailUrl: schema.assets.thumbnailUrl,
      mimeType: schema.assets.mimeType,
      width: schema.assets.width,
      height: schema.assets.height,
      durationSec: schema.assets.durationSec,
      sizeBytes: schema.assets.sizeBytes,
      slotIndex: schema.draftAssets.slotIndex,
      role: schema.draftAssets.role,
    })
    .from(schema.draftAssets)
    .innerJoin(
      schema.assets,
      eq(schema.draftAssets.assetId, schema.assets.id),
    )
    .where(eq(schema.draftAssets.draftId, draftId));

  return {
    format: draft.format,
    caption: draft.caption,
    trial:
      draft.metaJson?.trialReel === 'manual' || draft.metaJson?.trialReel === 'auto'
        ? draft.metaJson.trialReel
        : null,
    assets: assetRows.map((r) => ({ ...r })),
  };
}

/**
 * Re-queue failed posts whose backoff window has elapsed. Driven by the
 * `/api/cron/jobs-retry` handler. Posts that have exceeded
 * `PUBLISH_MAX_ATTEMPTS` are left terminal-failed and surfaced in alerts.
 */
export async function requeueFailedPosts(
  deps: PublishDueDeps = {},
): Promise<{ requeued: number }> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? (() => new Date());

  const rows = await db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.status, "failed"),
        lt(schema.posts.publishAttempts, PUBLISH_MAX_ATTEMPTS),
      ),
    );

  let requeued = 0;
  for (const post of rows) {
    if (!post.lastErrorAt) continue;
    // Belt + suspenders: the SQL filter already caps this, but enforce in JS
    // too so the cron is correct even if the row mutation pattern changes.
    if (post.publishAttempts >= PUBLISH_MAX_ATTEMPTS) continue;
    // attempts==1 → 60s, 2 → 300s, 3 → 1800s.
    const delaySec =
      PUBLISH_RETRY_DELAYS_SECONDS[
        Math.min(
          post.publishAttempts - 1,
          PUBLISH_RETRY_DELAYS_SECONDS.length - 1,
        )
      ] ?? 60;
    const eligibleAt = new Date(post.lastErrorAt.getTime() + delaySec * 1000);
    if (eligibleAt > now()) continue;
    await db
      .update(schema.posts)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(schema.posts.id, post.id));
    await recordEvent(
      {
        entityType: "post",
        entityId: post.id,
        fromStatus: "failed",
        toStatus: "queued",
        note: `retry after ${delaySec}s backoff`,
      },
      db,
    );
    requeued++;
  }

  return { requeued };
}

// ---------------------------------------------------------------------------
// Default Meta Graph callers (bypass — see file header CONCERN note)
// ---------------------------------------------------------------------------

const defaultPollContainer: ContainerPoller = async ({
  containerId,
  accessToken,
  graphVersion = "v27.0",
}) => {
  const url = `https://graph.facebook.com/${graphVersion}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`pollContainer ${containerId}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { status_code?: string };
  const code = body.status_code ?? "IN_PROGRESS";
  if (
    code === "FINISHED" ||
    code === "IN_PROGRESS" ||
    code === "ERROR" ||
    code === "EXPIRED"
  ) {
    return code;
  }
  return "IN_PROGRESS";
};

const defaultPublishContainer: ContainerPublisher = async ({
  containerId,
  igUserId,
  accessToken,
  graphVersion = "v27.0",
}) => {
  const url = `https://graph.facebook.com/${graphVersion}/${igUserId}/media_publish`;
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  });
  const res = await fetch(url, {
    method: "POST",
    body: params,
  });
  if (!res.ok) {
    throw new Error(`media_publish ${containerId}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { id?: string; permalink?: string };
  if (!body.id) {
    throw new Error(`media_publish ${containerId}: no media id in response`);
  }
  // media_publish returns only the id; fetch the permalink so the calendar can link to the post.
  let permalink = body.permalink;
  if (!permalink) {
    try {
      const info = await fetch(
        `https://graph.facebook.com/${graphVersion}/${body.id}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`,
      );
      if (info.ok) {
        permalink = ((await info.json()) as { permalink?: string }).permalink;
      }
    } catch {
      // The post is live either way; a missing link is not a publish failure.
    }
  }
  return { mediaId: body.id, permalink };
};

export const __internals = { sql };
