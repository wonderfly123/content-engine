/**
 * State machine helpers for brief / draft / post per Section 6 of the spec.
 *
 * Transitions are validated with `assertTransition*` — illegal moves throw.
 * The accompanying `events` row is the responsibility of the caller (see
 * `events.ts` and the per-pipeline modules); we keep the state graph pure
 * and DB-free so it is trivially unit-testable.
 */

import type { BriefStatus, DraftStatus, PostStatus } from "@/lib/db/enums";

export class IllegalStateTransition extends Error {
  constructor(
    public readonly entity: "brief" | "draft" | "post",
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Illegal ${entity} transition: ${from} → ${to}`);
    this.name = "IllegalStateTransition";
  }
}

// ---------------------------------------------------------------------------
// Brief: pending_review → {approved | edited → approved | rejected}
// ---------------------------------------------------------------------------

const BRIEF_GRAPH: Record<BriefStatus, BriefStatus[]> = {
  pending_review: ["approved", "edited", "rejected"],
  edited: ["approved", "rejected", "edited"],
  approved: [],
  rejected: [],
};

export function canBriefTransition(from: BriefStatus, to: BriefStatus): boolean {
  return BRIEF_GRAPH[from]?.includes(to) ?? false;
}

export function assertBriefTransition(
  from: BriefStatus,
  to: BriefStatus,
): void {
  if (!canBriefTransition(from, to)) {
    throw new IllegalStateTransition("brief", from, to);
  }
}

// ---------------------------------------------------------------------------
// Draft: pending_review → {approved | edited → approved | rejected}
//        approved → awaiting_assets → awaiting_final_review → scheduled
// ---------------------------------------------------------------------------

const DRAFT_GRAPH: Record<DraftStatus, DraftStatus[]> = {
  pending_review: ["approved", "edited", "rejected"],
  edited: ["approved", "rejected", "edited"],
  approved: ["awaiting_assets"],
  awaiting_assets: ["awaiting_final_review", "rejected"],
  awaiting_final_review: ["scheduled", "edited", "rejected"],
  scheduled: [],
  rejected: [],
};

export function canDraftTransition(from: DraftStatus, to: DraftStatus): boolean {
  return DRAFT_GRAPH[from]?.includes(to) ?? false;
}

export function assertDraftTransition(
  from: DraftStatus,
  to: DraftStatus,
): void {
  if (!canDraftTransition(from, to)) {
    throw new IllegalStateTransition("draft", from, to);
  }
}

// ---------------------------------------------------------------------------
// Post: queued → publishing → {published | failed}
//       failed → publishing (retry; jobs-retry cron re-queues)
//       failed (3+ attempts) is terminal — guarded at call sites, not here
// ---------------------------------------------------------------------------

const POST_GRAPH: Record<PostStatus, PostStatus[]> = {
  queued: ["publishing", "failed"],
  publishing: ["published", "failed", "publishing"],
  failed: ["publishing", "failed"],
  published: [],
};

export function canPostTransition(from: PostStatus, to: PostStatus): boolean {
  return POST_GRAPH[from]?.includes(to) ?? false;
}

export function assertPostTransition(
  from: PostStatus,
  to: PostStatus,
): void {
  if (!canPostTransition(from, to)) {
    throw new IllegalStateTransition("post", from, to);
  }
}

/** Retry policy: exponential backoff per spec Section 6 / Pipeline 5a. */
export const PUBLISH_RETRY_DELAYS_SECONDS = [60, 300, 1800] as const;
export const PUBLISH_MAX_ATTEMPTS = 3;

/**
 * Given the current attempt count (post-increment, i.e. value of
 * `posts.publish_attempts` after this failure) return the delay in seconds
 * before the next retry, or `null` when the post has hit the terminal cap.
 */
export function nextPublishRetryDelay(attempts: number): number | null {
  if (attempts >= PUBLISH_MAX_ATTEMPTS) return null;
  // attempts==1 → first backoff (60s), attempts==2 → 300s, attempts==3 → null
  const idx = Math.max(0, attempts - 1);
  return PUBLISH_RETRY_DELAYS_SECONDS[idx] ?? null;
}
