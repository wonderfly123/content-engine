import { describe, it, expect } from "vitest";
import { getOptimalTimes, isOptimalSlot } from "../optimal-times";

describe("getOptimalTimes", () => {
  it("returns the top 5 by score from heatmap", () => {
    const heatmap = Array.from({ length: 20 }).map((_, i) => ({
      dow: i % 7,
      hour: (i + 8) % 24,
      score: i,
    }));
    const slots = getOptimalTimes({
      heatmap,
      channel: "instagram",
      format: "reel",
    });
    expect(slots).toHaveLength(5);
    expect(slots[0]!.score).toBe(19);
    expect(slots[4]!.score).toBe(15);
  });

  it("filters by channel/format when present on the heatmap entry", () => {
    const heatmap = [
      { dow: 1, hour: 10, score: 5, channel: "instagram" as const, format: "reel" as const },
      { dow: 2, hour: 11, score: 9, channel: "facebook" as const, format: "post" as const },
    ];
    const slots = getOptimalTimes({
      heatmap,
      channel: "instagram",
      format: "reel",
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.dayOfWeek).toBe(1);
  });

  it("falls back to category defaults when heatmap empty", () => {
    const ig = getOptimalTimes({
      heatmap: [],
      channel: "instagram",
      format: "reel",
    });
    expect(ig.length).toBeGreaterThan(0);

    const fb = getOptimalTimes({
      heatmap: null,
      channel: "facebook",
      format: "post",
    });
    expect(fb.length).toBeGreaterThan(0);
  });

  it("isOptimalSlot matches dow/hour", () => {
    const slots = [{ dayOfWeek: 2, hour: 19, score: 1 }];
    // 2026-06-02 was a Tuesday
    const d = new Date(2026, 5, 2, 19, 0, 0);
    expect(isOptimalSlot(d, slots)).toBe(true);
    const off = new Date(2026, 5, 2, 20, 0, 0);
    expect(isOptimalSlot(off, slots)).toBe(false);
  });
});
