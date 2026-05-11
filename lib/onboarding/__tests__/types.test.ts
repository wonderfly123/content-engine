import { describe, expect, it } from "vitest";
import {
  cadenceSchema,
  competitorsInspirationSchema,
  createBrandSchema,
  icpsSchema,
  profileSchema,
} from "../types";

describe("createBrandSchema", () => {
  it("rejects empty payload", () => {
    const r = createBrandSchema.safeParse({});
    expect(r.success).toBe(false);
  });
  it("accepts url-only", () => {
    const r = createBrandSchema.safeParse({ websiteUrl: "https://example.com" });
    expect(r.success).toBe(true);
  });
  it("accepts description-only", () => {
    const r = createBrandSchema.safeParse({ description: "what we do" });
    expect(r.success).toBe(true);
  });
  it("rejects invalid url", () => {
    const r = createBrandSchema.safeParse({ websiteUrl: "not-a-url" });
    expect(r.success).toBe(false);
  });
});

describe("profileSchema", () => {
  it("requires name and valid slug", () => {
    const r = profileSchema.safeParse({
      name: "",
      slug: "Bad Slug",
      archetype: "creator",
    });
    expect(r.success).toBe(false);
  });
  it("accepts a minimal payload with defaults", () => {
    const r = profileSchema.safeParse({
      name: "Acme",
      slug: "acme",
      archetype: "creator",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.toneSliders.formality).toBe(50);
      expect(r.data.emojiPolicy).toBe("sparing");
    }
  });
});

describe("icpsSchema", () => {
  it("requires at least one ICP", () => {
    const r = icpsSchema.safeParse({ icps: [] });
    expect(r.success).toBe(false);
  });
  it("rejects more than one default", () => {
    const r = icpsSchema.safeParse({
      icps: [
        { name: "A", isDefault: true },
        { name: "B", isDefault: true },
      ],
    });
    expect(r.success).toBe(false);
  });
  it("allows zero default (action layer assigns it)", () => {
    const r = icpsSchema.safeParse({
      icps: [{ name: "A" }, { name: "B" }],
    });
    expect(r.success).toBe(true);
  });
});

describe("cadenceSchema", () => {
  it("accepts a preset with no rows", () => {
    const r = cadenceSchema.safeParse({ preset: "growth" });
    expect(r.success).toBe(true);
  });
  it("custom can carry rows", () => {
    const r = cadenceSchema.safeParse({
      preset: "custom",
      rows: [
        {
          channel: "instagram",
          format: "reel",
          perWeek: 3,
          enabled: true,
        },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("rejects out-of-range perWeek", () => {
    const r = cadenceSchema.safeParse({
      preset: "custom",
      rows: [
        {
          channel: "instagram",
          format: "reel",
          perWeek: 999,
          enabled: true,
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("competitorsInspirationSchema", () => {
  it("accepts empty payload", () => {
    const r = competitorsInspirationSchema.safeParse({});
    expect(r.success).toBe(true);
  });
  it("rejects more than 10 entries", () => {
    const accounts = Array.from({ length: 11 }, (_, i) => ({
      handle: `acc${i}`,
      platform: "ig" as const,
      pullWindowDays: 30,
    }));
    const r = competitorsInspirationSchema.safeParse({
      competitors: accounts,
    });
    expect(r.success).toBe(false);
  });
});
