import { describe, expect, it, vi } from "vitest";
import { analyzeBrand } from "../analyze";
import type { LLMProvider, PersonaDraft } from "@/lib/llm/types";
import type { Researcher, ScrapedSite } from "@/lib/research/types";

function stubResearcher(
  fn?: (url: string) => Promise<ScrapedSite>,
): Researcher {
  return {
    scrapeSite: vi.fn(
      fn ??
        (async (url: string) => ({
          url,
          title: "Acme — fast widgets",
          description: "Widgets for makers",
          markdown: "# Acme\nWidgets for makers.",
          scraped_at: "2026-05-08T00:00:00Z",
        })),
    ),
    searchKeyword: vi.fn(async () => []),
  };
}

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
    await expect(
      analyzeBrand({}, { researcher: stubResearcher(), llm: stubLLM() }),
    ).rejects.toThrow(/websiteUrl or description/);
  });

  it("scrapes the site and extracts persona for url-only input", async () => {
    const researcher = stubResearcher();
    const llm = stubLLM();
    const result = await analyzeBrand(
      { websiteUrl: "https://acme.example" },
      { researcher, llm },
    );

    expect(researcher.scrapeSite).toHaveBeenCalledWith("https://acme.example");
    expect(llm.extractPersona).toHaveBeenCalledTimes(1);

    expect(result.profile.name).toBe("Acme");
    expect(result.profile.slug).toBe("acme");
    expect(result.profile.archetype).toBe("creator");
    expect(result.icps).toHaveLength(1);
    expect(result.icps[0]?.isDefault).toBe(true);
    expect(result.cadence.preset).toBe("growth");
    expect(result.cadence.rows.some((r) => r.format === "reel")).toBe(true);
  });

  it("falls back to description-only when scrape fails", async () => {
    const researcher = stubResearcher(async () => {
      throw new Error("network down");
    });
    const llm = stubLLM({ archetype: "sage" });

    const result = await analyzeBrand(
      { description: "Tools for thoughtful makers" },
      { researcher, llm },
    );

    expect(llm.extractPersona).toHaveBeenCalledTimes(1);
    expect(result.profile.archetype).toBe("sage");
  });

  it("normalizes unknown archetype to creator", async () => {
    const result = await analyzeBrand(
      { description: "x" },
      { researcher: stubResearcher(), llm: stubLLM({ archetype: "trickster" }) },
    );
    expect(result.profile.archetype).toBe("creator");
  });
});
