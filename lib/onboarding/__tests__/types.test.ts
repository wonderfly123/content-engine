import { describe, expect, it } from "vitest";
import {
  resolveOnboardingStep,
  createBrandSchema,
  icpsSchema,
  profileSchema,
} from "../types";

describe("createBrandSchema", () => {
  it("rejects empty payload", () => {
    const r = createBrandSchema.safeParse({});
    expect(r.success).toBe(false);
  });
  it("needs a description; a website alone is not enough to draft a brand", () => {
    const r = createBrandSchema.safeParse({ websiteUrl: "https://example.com" });
    expect(r.success).toBe(false);
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

describe("resolveOnboardingStep", () => {
  it("defaults to step 1", () => {
    expect(resolveOnboardingStep(undefined)).toBe(1);
    expect(resolveOnboardingStep({})).toBe(1);
  });
  it("reads a step saved by the 7-step wizard as it is", () => {
    expect(resolveOnboardingStep({ currentStep: 6, stepsVersion: 2 })).toBe(6);
    expect(resolveOnboardingStep({ currentStep: 3 })).toBe(3);
  });
  it("maps a step saved by the earlier 8-step wizard onto today's steps", () => {
    expect(resolveOnboardingStep({ currentStep: 5 })).toBe(5); // removed step -> cadence
    expect(resolveOnboardingStep({ currentStep: 6 })).toBe(5); // cadence
    expect(resolveOnboardingStep({ currentStep: 7 })).toBe(6); // channels
    expect(resolveOnboardingStep({ currentStep: 8 })).toBe(7); // done
  });
  it("never leaves the 1-7 range", () => {
    expect(resolveOnboardingStep({ currentStep: 99, stepsVersion: 2 })).toBe(7);
    expect(resolveOnboardingStep({ currentStep: 0 })).toBe(1);
  });
});
