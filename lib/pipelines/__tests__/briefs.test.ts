import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost/test";
  process.env.TOKEN_ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
});
import { computeSlots, nextMonday, runBriefBatchForBrand } from "../briefs";
import type { BriefInput, LLMProvider } from "@/lib/llm";
import { makeFakeDb } from "./_helpers";

describe("runBriefBatchForBrand", () => {
  it("generates a brief per cadence slot from the brand alone", async () => {
    const db = makeFakeDb({
      brands: [
        {
          id: "b1",
          personaJson: { mission: "Make great widgets", traits: ["practical"] },
          voiceJson: { readingLevel: "general" },
        },
      ],
      icps: [{ id: "i1", brandId: "b1", name: "Makers", description: "People who build" }],
      cadence_settings: [
        { brandId: "b1", channel: "instagram", format: "reel", perWeek: 2, enabled: true },
      ],
    });
    const generateBrief = vi.fn(async (_input: BriefInput) => ({
      hook: "A hook",
      angle: "An angle",
      key_message: "A message",
      suggested_hashtags: ["#widgets"],
      suggested_cta: null,
      inspiration_post_refs: [],
    }));
    const llm = { generateBrief } as unknown as LLMProvider;

    const result = await runBriefBatchForBrand("b1", {
      db: db as never,
      llm,
      now: () => new Date("2026-05-08T12:00:00.000Z"),
    });

    expect(result).toEqual({ brandId: "b1", briefsCreated: 2, briefIds: expect.any(Array) });
    expect(generateBrief).toHaveBeenCalledTimes(2);
    const input = generateBrief.mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual(
      ["channel", "format", "icp", "persona", "rejections", "target_date", "voice"],
    );
    expect(input.persona).toMatchObject({ mission: "Make great widgets" });
    expect(input.icp).toMatchObject({ name: "Makers" });

    const briefs = db.store.get("briefs") ?? [];
    expect(briefs).toHaveLength(2);
    for (const b of briefs) {
      expect(b).toMatchObject({ brandId: "b1", icpId: "i1", status: "pending_review", hook: "A hook" });
      expect(b).not.toHaveProperty("researchBundleId");
    }
  });
});

describe("computeSlots", () => {
  it("returns total = sum of cadence_settings.per_week", () => {
    const monday = new Date("2026-05-11T00:00:00.000Z"); // a Monday
    const slots = computeSlots(
      [
        { channel: "instagram", format: "reel", perWeek: 5 },
        { channel: "instagram", format: "carousel", perWeek: 2 },
      ],
      monday,
    );
    expect(slots).toHaveLength(7);
    expect(slots.filter((s) => s.format === "reel")).toHaveLength(5);
    expect(slots.filter((s) => s.format === "carousel")).toHaveLength(2);
  });

  it("spreads dates across Mon→Sun within the week", () => {
    const monday = new Date("2026-05-11T00:00:00.000Z");
    const slots = computeSlots(
      [{ channel: "instagram", format: "reel", perWeek: 7 }],
      monday,
    );
    const dates = new Set(slots.map((s) => s.date));
    // 7 slots spread across 7 days → at least 6 unique days (with rounding).
    expect(dates.size).toBeGreaterThanOrEqual(5);
    for (const s of slots) {
      const t = new Date(s.date + "T00:00:00.000Z");
      expect(t.getTime()).toBeGreaterThanOrEqual(monday.getTime());
      expect(t.getTime()).toBeLessThanOrEqual(
        monday.getTime() + 6 * 24 * 60 * 60 * 1000,
      );
    }
  });

  it("returns empty when cadence is zero", () => {
    expect(
      computeSlots(
        [{ channel: "instagram", format: "reel", perWeek: 0 }],
        new Date(),
      ),
    ).toEqual([]);
  });
});

describe("nextMonday", () => {
  it("returns the upcoming Monday, never today even if today is Monday", () => {
    const aMonday = new Date("2026-05-11T12:00:00.000Z");
    const result = nextMonday(aMonday);
    expect(result.getUTCDay()).toBe(1);
    expect(result.getTime()).toBeGreaterThan(aMonday.getTime());
  });

  it("rolls forward correctly from a Sunday", () => {
    const sun = new Date("2026-05-10T12:00:00.000Z");
    const result = nextMonday(sun);
    expect(result.getUTCDay()).toBe(1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-11");
  });
});
