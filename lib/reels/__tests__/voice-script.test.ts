import { describe, expect, it } from "vitest";
import { speakableScript, spokenTextProblem, unfilledBrackets } from "../voice-script";

const DRAFT = "ANGLE: the dry run at home\n\nSCRIPT (a starting point: change the words, fill the brackets)\n\nSo there's a cider stand in my kitchen right now.\n\n[What you noticed or had to fix.]\n\nStill need some pumpkins.\n\nQUESTIONS (to get you thinking; answer any of these instead)\n\n1. Why set it up at home?\n\nGaps are fine. The music covers them.";

describe("speakableScript", () => {
  it("keeps only the SCRIPT section of an editor's draft", () => {
    expect(speakableScript(DRAFT)).toBe("So there's a cider stand in my kitchen right now.\n\n[What you noticed or had to fix.]\n\nStill need some pumpkins.");
  });
  it("returns a plain script unchanged and copes with none", () => {
    expect(speakableScript("One line.\nAnother line.")).toBe("One line.\nAnother line.");
    expect(speakableScript(undefined)).toBe("");
  });
});

describe("spokenTextProblem", () => {
  it("refuses empty text and unfilled brackets, and accepts a finished script", () => {
    expect(spokenTextProblem("  ")).toMatch(/Write what/);
    expect(unfilledBrackets(speakableScript(DRAFT))).toEqual(["[What you noticed or had to fix.]"]);
    expect(spokenTextProblem(speakableScript(DRAFT))).toMatch(/bracket/);
    expect(spokenTextProblem("So there's a cider stand in my kitchen right now.")).toBeNull();
  });
});
