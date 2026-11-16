import { describe, expect, it } from "vitest";
import { FLOW_VERSION, needsOnboarding, researchIsRunning, resumeStep, RESEARCH_STALE_MS, slugFromName } from "../flow";
import { aboutSchema, reviewSchema } from "../flow-schemas";

const inFlow = (step = 3) => ({ status: "draft", settingsJson: { onboarding: { flow: FLOW_VERSION, currentStep: step } } });

describe("who is sent to onboarding", () => {
  const base = { isPlatformAdmin: false, hasWorkspace: true };

  it("sends a user whose workspace has no brands", () => {
    expect(needsOnboarding({ ...base, brands: [] })).toBe(true);
  });

  it("sends a user whose only brands are unfinished drafts from this flow", () => {
    expect(needsOnboarding({ ...base, brands: [inFlow(2), inFlow(5)] })).toBe(true);
  });

  it("does not send a user with an active brand", () => {
    expect(needsOnboarding({ ...base, brands: [{ status: "active", settingsJson: {} }] })).toBe(false);
    expect(needsOnboarding({ ...base, brands: [{ status: "active", settingsJson: {} }, inFlow()] })).toBe(false);
  });

  it("leaves existing users alone: older drafts and archived brands do not trigger it", () => {
    expect(needsOnboarding({ ...base, brands: [{ status: "draft", settingsJson: { onboarding: { currentStep: 4 } } }] })).toBe(false);
    expect(needsOnboarding({ ...base, brands: [{ status: "archived", settingsJson: {} }] })).toBe(false);
  });

  it("never sends the platform admin (the owner), even with no brands", () => {
    expect(needsOnboarding({ isPlatformAdmin: true, hasWorkspace: true, brands: [] })).toBe(false);
  });

  it("does not send someone without a workspace (nothing to set up in)", () => {
    expect(needsOnboarding({ isPlatformAdmin: false, hasWorkspace: false, brands: [] })).toBe(false);
  });
});

describe("resuming", () => {
  it("resumes on the saved step, and sends older drafts to About", () => {
    expect(resumeStep({ flow: FLOW_VERSION, currentStep: 5 })).toBe(5);
    expect(resumeStep({ flow: FLOW_VERSION, currentStep: 99 })).toBe(7);
    expect(resumeStep({ currentStep: 4 })).toBe(3);
  });

  it("treats a run that has said running for too long as dead", () => {
    const now = Date.now();
    expect(researchIsRunning({ research: { status: "running", startedAt: new Date(now - 1000).toISOString() } }, now)).toBe(true);
    expect(researchIsRunning({ research: { status: "running", startedAt: new Date(now - RESEARCH_STALE_MS - 1).toISOString() } }, now)).toBe(false);
  });
});

describe("step inputs", () => {
  it("accepts a bare domain, strips @ from the handle, and drops empty captions", () => {
    const out = aboutSchema.parse({ websiteUrl: "sunset.example", instagramHandle: "@sunset_taco", summary: "Tacos.", captions: ["", "Come hungry."] });
    expect(out).toEqual({ websiteUrl: "https://sunset.example", instagramHandle: "sunset_taco", summary: "Tacos.", captions: ["Come hungry."] });
  });

  it("rejects a handle with spaces and an empty fact", () => {
    expect(aboutSchema.safeParse({ instagramHandle: "not a handle", summary: "Tacos." }).success).toBe(false);
    expect(reviewSchema.safeParse({ name: "A", whatTheyDo: "B", facts: [{ fact: "  " }] }).success).toBe(false);
  });

  it("makes slugs from names", () => {
    expect(slugFromName("Café Olé & Co.")).toBe("cafe-ole-co");
    expect(slugFromName("!!!")).toBe("brand");
  });
});
