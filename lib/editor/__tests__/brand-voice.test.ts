import { describe, expect, it } from "vitest";
import { brandVoice } from "../brand-voice";

const brand = {
  description: "A taco truck in Ocean Beach.",
  personaJson: { audienceSummary: "Late-night locals" },
  voiceJson: {},
  voiceFreeform: "Warm and short.",
  voiceExamples: [{ caption: "Al pastor tonight." }],
};

describe("brandVoice and brand facts", () => {
  it("lists the brand facts as the only ones the editor may use", () => {
    const text = brandVoice({
      ...brand,
      voiceJson: { facts: [{ fact: "Parked on Newport Ave on Fridays", source: "https://x.example" }, { fact: "Taco Tuesday: $2 tacos" }] },
    });
    expect(text).toContain("Brand facts you may use (never invent others");
    expect(text).toContain("- Parked on Newport Ave on Fridays");
    expect(text).toContain("- Taco Tuesday: $2 tacos");
    expect(text).not.toContain("https://x.example");
    expect(text.indexOf("About: A taco truck")).toBeLessThan(text.indexOf("Brand facts"));
  });

  it("says so when the list was set up but is empty", () => {
    expect(brandVoice({ ...brand, voiceJson: { facts: [] } })).toMatch(/Brand facts: none given/);
  });

  it("leaves brands without stored facts as they were", () => {
    const text = brandVoice(brand);
    expect(text).not.toMatch(/Brand facts/);
    expect(text).toContain("Voice: Warm and short.");
  });

  it("never cuts the facts off when the rest is long", () => {
    const text = brandVoice({ ...brand, voiceFreeform: "x".repeat(9000), voiceJson: { facts: [{ fact: "The last fact" }] } });
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(text).toContain("- The last fact");
  });
});
