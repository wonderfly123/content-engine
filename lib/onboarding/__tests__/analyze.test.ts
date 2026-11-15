import { describe, expect, it, vi } from "vitest";
import { analyzeBrand } from "../analyze";
import type { LLMProvider, PersonaDraft } from "@/lib/llm/types";

function stubLLM(persona?: Partial<PersonaDraft>): LLMProvider {
  const full: PersonaDraft = {
    mission: persona?.mission ?? "Make great widgets",
    audience_summary:
      persona?.audience_summary ?? "Makers who need reliable widgets",
    archetype: persona?.archetype ?? "creator",
    pov: persona?.pov ?? "Tools should disappear",
    traits: persona?.traits ?? ["practical", "honest"],
  };
  return {
    extractPersona: vi.fn(async () => full),
    generateBrief: vi.fn(),
    generateDraft: vi.fn(),
    generateImagePrompts: vi.fn(),
  };
}

describe("analyzeBrand", () => {
  it("rejects when neither url nor description provided", async () => {
    await expect(analyzeBrand({}, { llm: stubLLM() })).rejects.toThrow(
      /websiteUrl or description/,
    );
  });

  it("asks for a description when only a website is given", async () => {
    const llm = stubLLM();
    await expect(
      analyzeBrand({ websiteUrl: "https://acme.example" }, { llm }),
    ).rejects.toThrow(/Add a description/);
    expect(llm.extractPersona).not.toHaveBeenCalled();
  });

  it("extracts the persona from the description", async () => {
    const llm = stubLLM({ archetype: "sage" });

    const result = await analyzeBrand(
      { description: "Tools for thoughtful makers" },
      { llm },
    );

    expect(llm.extractPersona).toHaveBeenCalledTimes(1);
    expect(llm.extractPersona).toHaveBeenCalledWith(
      expect.stringContaining("Tools for thoughtful makers"),
    );
    expect(result.profile.name).toBe("New brand");
    expect(result.profile.archetype).toBe("sage");
    expect(result.icps).toHaveLength(1);
    expect(result.icps[0]?.isDefault).toBe(true);
    expect(result.cadence.preset).toBe("growth");
    expect(result.cadence.rows.some((r) => r.format === "reel")).toBe(true);
  });

  it("names the brand after the website host without reading the site", async () => {
    const result = await analyzeBrand(
      { websiteUrl: "https://www.acme.example", description: "Widgets for makers" },
      { llm: stubLLM() },
    );
    expect(result.profile.name).toBe("acme.example");
    expect(result.profile.slug).toBe("acme-example");
    expect(result.sourceUrl).toBe("https://www.acme.example");
  });

  it("normalizes unknown archetype to creator", async () => {
    const result = await analyzeBrand(
      { description: "x" },
      { llm: stubLLM({ archetype: "trickster" }) },
    );
    expect(result.profile.archetype).toBe("creator");
  });
});
