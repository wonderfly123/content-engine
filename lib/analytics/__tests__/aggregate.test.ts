import { describe, it, expect } from "vitest";
import {
  buildEngagementTrend,
  buildReachTrend,
  computeTopline,
  engagementOf,
  filterRows,
  type PostAggRow,
} from "../aggregate";
import { resolveEnabledChannels, type AnalyticsFilters } from "../filters";
import { channelValues } from "@/lib/db/enums";

const row = (over: Partial<PostAggRow>): PostAggRow => ({
  postId: "p-" + Math.random().toString(36).slice(2, 8),
  brandId: "b1",
  channel: "instagram",
  format: "reel",
  icpId: null,
  publishedAt: new Date("2026-06-01T10:00:00Z"),
  reach: 1000,
  impressions: 1500,
  likes: 80,
  comments: 10,
  shares: 5,
  saves: 5,
  followsFromPost: 2,
  ...over,
});

const baseFilters: AnalyticsFilters = {
  channels: [],
  formats: [],
  icpId: null,
  dateRange: "30d",
  from: null,
  to: null,
};

const range = {
  start: new Date("2026-05-01T00:00:00Z"),
  end: new Date("2026-07-01T00:00:00Z"),
};

describe("filterRows", () => {
  it("filters by channel + format + icp + window", () => {
    const rows = [
      row({}),
      row({ channel: "facebook" }),
      row({ format: "post" }),
      row({ publishedAt: new Date("2025-01-01T00:00:00Z") }),
      row({ icpId: "abc" }),
    ];
    const out = filterRows(
      rows,
      { ...baseFilters, channels: ["instagram"], formats: ["reel"] },
      range,
    );
    // The base row + the row with icpId=abc both match channel=ig + format=reel.
    expect(out.length).toBe(2);
  });
});

describe("resolveEnabledChannels", () => {
  it("returns all channels when settings are absent or key is missing", () => {
    expect(resolveEnabledChannels(null)).toEqual([...channelValues]);
    expect(resolveEnabledChannels(undefined)).toEqual([...channelValues]);
    expect(resolveEnabledChannels({})).toEqual([...channelValues]);
  });

  it("returns only the listed channels when present", () => {
    expect(
      resolveEnabledChannels({ enabledChannels: ["instagram", "blog"] }),
    ).toEqual(["instagram", "blog"]);
  });

  it("returns an empty list when everything is disabled", () => {
    expect(resolveEnabledChannels({ enabledChannels: [] })).toEqual([]);
  });

  it("drops unknown channel values defensively", () => {
    expect(
      resolveEnabledChannels({
        enabledChannels: ["instagram", "myspace"] as never,
      }),
    ).toEqual(["instagram"]);
  });
});

describe("computeTopline", () => {
  it("sums + averages correctly", () => {
    const rows = [row({ reach: 100 }), row({ reach: 200 })];
    const t = computeTopline(rows, 42);
    expect(t.postsPublished).toBe(2);
    expect(t.totalReach).toBe(300);
    expect(t.avgReachPerPost).toBe(150);
    expect(t.followerDelta).toBe(42);
    expect(t.topFormat.format).toBe("reel");
  });

  it("handles empty rows safely", () => {
    const t = computeTopline([], 0);
    expect(t.postsPublished).toBe(0);
    expect(t.totalReach).toBe(0);
    expect(t.avgReachPerPost).toBe(0);
    expect(t.engagementRate).toBe(0);
    expect(t.topFormat.format).toBeNull();
  });
});

describe("engagementOf", () => {
  it("computes rate over reach", () => {
    const e = engagementOf(
      row({ reach: 1000, likes: 50, comments: 25, shares: 15, saves: 10 }),
    );
    expect(e.interactions).toBe(100);
    expect(e.rate).toBeCloseTo(0.1);
  });

  it("returns 0 when reach is 0", () => {
    const e = engagementOf(row({ reach: 0 }));
    expect(e.rate).toBe(0);
  });
});

describe("trends", () => {
  it("buildReachTrend buckets by ISO date", () => {
    const rows = [
      row({ publishedAt: new Date("2026-06-01T10:00:00Z"), reach: 100 }),
      row({ publishedAt: new Date("2026-06-01T18:00:00Z"), reach: 50 }),
      row({ publishedAt: new Date("2026-06-02T12:00:00Z"), reach: 200 }),
    ];
    const t = buildReachTrend(rows, "all");
    expect(t).toHaveLength(2);
    expect(t[0]!.reach).toBe(150);
    expect(t[1]!.reach).toBe(200);
  });

  it("buildReachTrend split by channel", () => {
    const rows = [
      row({ publishedAt: new Date("2026-06-01T10:00:00Z"), channel: "instagram", reach: 100 }),
      row({ publishedAt: new Date("2026-06-01T11:00:00Z"), channel: "facebook", reach: 200 }),
    ];
    const t = buildReachTrend(rows, "channel");
    expect(t[0]!.instagram).toBe(100);
    expect(t[0]!.facebook).toBe(200);
  });

  it("buildEngagementTrend averages per day", () => {
    const rows = [
      row({ publishedAt: new Date("2026-06-01T10:00:00Z"), reach: 1000, likes: 100, comments: 0, shares: 0, saves: 0 }),
      row({ publishedAt: new Date("2026-06-01T18:00:00Z"), reach: 1000, likes: 200, comments: 0, shares: 0, saves: 0 }),
    ];
    const t = buildEngagementTrend(rows);
    expect(t).toHaveLength(1);
    expect(t[0]!.er).toBeCloseTo(0.15);
  });
});

describe("combineFollowerSeries", () => {
  it("sums channels into one point per day instead of treating them as a sequence", async () => {
    const { combineFollowerSeries } = await import("../aggregate");
    const out = combineFollowerSeries([
      { pulledAt: new Date("2026-11-11T10:00:00Z"), channel: "instagram", followerCount: 1377 },
      { pulledAt: new Date("2026-11-11T10:00:01Z"), channel: "facebook", followerCount: 0 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].followerCount).toBe(1377);
  });

  it("carries a channel's last count forward on days it was not sampled, and skips nulls", async () => {
    const { combineFollowerSeries } = await import("../aggregate");
    const out = combineFollowerSeries([
      { pulledAt: new Date("2026-11-11T10:00:00Z"), channel: "instagram", followerCount: 1000 },
      { pulledAt: new Date("2026-11-11T10:00:01Z"), channel: "facebook", followerCount: 50 },
      { pulledAt: new Date("2026-11-12T10:00:00Z"), channel: "instagram", followerCount: 1010 },
      { pulledAt: new Date("2026-11-12T10:00:01Z"), channel: "facebook", followerCount: null },
    ]);
    expect(out.map((p) => p.followerCount)).toEqual([1050, 1060]);
  });
});
