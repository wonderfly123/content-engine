/**
 * Reschedule helper — validates a drag-drop target for a queued post.
 *
 * Pure validation; the actual UPDATE lives in `/api/posts/[id]` PATCH.
 */

import type { PostStatus } from "@/lib/db/enums";

export interface RescheduleCheck {
  ok: boolean;
  reason?: string;
}

export interface ReschedulePostInput {
  status: PostStatus;
  scheduledFor: Date;
  target: Date;
  /** Optional: existing scheduled times to avoid collisions. */
  others?: Date[];
  /** Don't allow scheduling in the past. */
  now?: Date;
}

export function canReschedule(input: ReschedulePostInput): RescheduleCheck {
  const { status, target, others = [], now = new Date() } = input;

  if (status !== "queued") {
    return { ok: false, reason: "Only queued posts can be rescheduled" };
  }
  if (target.getTime() <= now.getTime()) {
    return { ok: false, reason: "Cannot schedule in the past" };
  }
  const collision = others.find(
    (o) => o.getTime() === target.getTime(),
  );
  if (collision) {
    return { ok: false, reason: "Another post is already at that time" };
  }
  return { ok: true };
}
