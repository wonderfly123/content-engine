import { describe, expect, it } from "vitest";
import {
  IllegalStateTransition,
  PUBLISH_MAX_ATTEMPTS,
  PUBLISH_RETRY_DELAYS_SECONDS,
  assertBriefTransition,
  assertDraftTransition,
  assertPostTransition,
  canBriefTransition,
  canDraftTransition,
  canPostTransition,
  nextPublishRetryDelay,
} from "../state";

describe("brief state machine", () => {
  it("allows legal transitions from pending_review", () => {
    expect(canBriefTransition("pending_review", "approved")).toBe(true);
    expect(canBriefTransition("pending_review", "edited")).toBe(true);
    expect(canBriefTransition("pending_review", "rejected")).toBe(true);
  });

  it("treats approved and rejected as terminal", () => {
    expect(canBriefTransition("approved", "pending_review")).toBe(false);
    expect(canBriefTransition("rejected", "approved")).toBe(false);
  });

  it("assertBriefTransition throws on illegal moves", () => {
    expect(() => assertBriefTransition("approved", "rejected")).toThrowError(
      IllegalStateTransition,
    );
  });
});

describe("draft state machine", () => {
  it("walks pending → approved → awaiting_assets → awaiting_final_review → scheduled", () => {
    expect(canDraftTransition("pending_review", "approved")).toBe(true);
    expect(canDraftTransition("approved", "awaiting_assets")).toBe(true);
    expect(
      canDraftTransition("awaiting_assets", "awaiting_final_review"),
    ).toBe(true);
    expect(canDraftTransition("awaiting_final_review", "scheduled")).toBe(true);
  });

  it("does not allow scheduling from approved directly", () => {
    expect(canDraftTransition("approved", "scheduled")).toBe(false);
    expect(() => assertDraftTransition("approved", "scheduled")).toThrowError(
      IllegalStateTransition,
    );
  });
});

describe("post state machine", () => {
  it("queued → publishing → published is legal", () => {
    expect(canPostTransition("queued", "publishing")).toBe(true);
    expect(canPostTransition("publishing", "published")).toBe(true);
  });

  it("publishing → publishing (long-running container) is legal", () => {
    expect(canPostTransition("publishing", "publishing")).toBe(true);
  });

  it("failed can recover to publishing (retry)", () => {
    expect(canPostTransition("failed", "publishing")).toBe(true);
  });

  it("published is terminal", () => {
    expect(canPostTransition("published", "queued")).toBe(false);
    expect(() => assertPostTransition("published", "failed")).toThrowError(
      IllegalStateTransition,
    );
  });
});

describe("retry backoff", () => {
  it("uses 1min, 5min, 30min for the first three failures", () => {
    expect(PUBLISH_RETRY_DELAYS_SECONDS).toEqual([60, 300, 1800]);
    expect(nextPublishRetryDelay(1)).toBe(60);
    expect(nextPublishRetryDelay(2)).toBe(300);
  });

  it("returns null at PUBLISH_MAX_ATTEMPTS", () => {
    expect(nextPublishRetryDelay(PUBLISH_MAX_ATTEMPTS)).toBeNull();
    expect(nextPublishRetryDelay(PUBLISH_MAX_ATTEMPTS + 1)).toBeNull();
  });
});
