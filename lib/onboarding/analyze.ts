/**
 * Step 2 orchestrator: turn a website URL + description into a drafted brand
 * profile (persona, voice freeform, default ICP, cadence preset).
 *
 * Pure, dependency-injectable: takes a `Researcher` and `LLMProvider` so tests
 * can supply stubs. Production callers use the factory `runAnalysis(input)`
 * which builds adapters from `lib/research` and `lib/llm`.
 */

import type { LLMProvider, PersonaDraft } from "@/lib/llm/types";
import { getLLMProvider } from "@/lib/llm";
import type { Researcher, ScrapedSite } from "@/lib/research/types";
import { getResearcher } from "@/lib/research";
import type { ProfileInput, IcpInput, CadenceInput } from "./types";
import { CADENCE_PRESETS } from "./types";

export interface AnalyzeInput {
  websiteUrl?: string;
  description?: string;
}

export interface DraftedProfile {
  profile: ProfileInput;
  icps: IcpInput[];
  cadence: CadenceInput;
  scrapedAt?: string;
  sourceUrl?: string;
}

export interface AnalyzeDeps {
  researcher: Researcher;
  llm: LLMProvider;
}

/** Best-effort slug from name; downstream form may override. */
function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 60) || "brand";
}

function deriveNameFromUrlOrPersona(
  scraped: ScrapedSite | undefined,
  persona: PersonaDraft,
  fallback: string,
): string {
  if (scraped?.title) {
    // Title often "Brand — Tagline"; take first segment
    const first = scraped.title.split(/[—|·•:|–-]/)[0]?.trim();
    if (first && first.length >= 2) return first;
  }
  if (persona.archetype && persona.audience_summary) {
    return fallback;
  }
  return fallback;
}

function defaultProfileFromPersona(
  name: string,
  persona: PersonaDraft,
  voiceFreeform: string,
): ProfileInput {
  return {
    name,
    slug: suggestSlug(name),
    tagline: persona.mission?.slice(0, 280) ?? "",
    audienceSummary: persona.audience_summary ?? "",
    archetype: normalizeArchetype(persona.archetype),
    traits: persona.traits ?? [],
    pointOfView: persona.pov ?? "",
    toneSliders: {
      formality: 50,
      playfulness: 50,
      authority: 60,
      boldness: 55,
      wit: 50,
      verbosity: 45,
    },
    emojiPolicy: "sparing",
    hashtagStyle: "few-strategic",
    readingLevel: "general",
    bannedWords: [],
    signaturePhrases: [],
    voiceFreeform,
    voiceExamples: [],
  };
}

function normalizeArchetype(raw: string | undefined): ProfileInput["archetype"] {
  const v = (raw ?? "").toLowerCase().trim();
  const allowed: ProfileInput["archetype"][] = [
    "hero",
    "sage",
    "jester",
    "outlaw",
    "explorer",
    "regular-guy",
    "lover",
    "caregiver",
    "ruler",
    "creator",
    "innocent",
    "magician",
  ];
  return (allowed.find((a) => a === v) ?? "creator");
}

function defaultIcp(persona: PersonaDraft): IcpInput {
  return {
    name: "Default audience",
    description: persona.audience_summary ?? "",
    painPoints: [],
    whereTheyHangOut: "",
    contentTheyEngageWith: "",
    isDefault: true,
  };
}

/**
 * Runs the analysis pipeline:
 *  1. If websiteUrl: scrape via Researcher.scrapeSite
 *  2. Build composite "content" string (scraped markdown + description)
 *  3. Call LLMProvider.extractPersona for structured persona
 *  4. Compose ProfileInput + ICP + Growth cadence preset
 */
export async function analyzeBrand(
  input: AnalyzeInput,
  deps: AnalyzeDeps,
): Promise<DraftedProfile> {
  if (!input.websiteUrl && !input.description) {
    throw new Error("analyzeBrand requires websiteUrl or description");
  }

  let scraped: ScrapedSite | undefined;
  if (input.websiteUrl) {
    try {
      scraped = await deps.researcher.scrapeSite(input.websiteUrl);
    } catch (err) {
      // Soft-fail scrape; downstream still extracts persona from description.
      scraped = undefined;
      if (!input.description) {
        throw err;
      }
    }
  }

  const composite = [
    scraped?.title ? `Site title: ${scraped.title}` : "",
    scraped?.description ? `Site description: ${scraped.description}` : "",
    scraped?.markdown ? scraped.markdown.slice(0, 12_000) : "",
    input.description ? `User-provided description:\n${input.description}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const persona = await deps.llm.extractPersona(composite);

  const name = deriveNameFromUrlOrPersona(
    scraped,
    persona,
    input.websiteUrl ? new URL(input.websiteUrl).hostname.replace(/^www\./, "") : "New brand",
  );

  const voiceFreeform = [
    persona.pov ? `Point of view: ${persona.pov}` : "",
    persona.traits?.length ? `Traits: ${persona.traits.join(", ")}.` : "",
    persona.mission ? `Mission: ${persona.mission}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const profile = defaultProfileFromPersona(name, persona, voiceFreeform);

  return {
    profile,
    icps: [defaultIcp(persona)],
    cadence: { preset: "growth", rows: [...CADENCE_PRESETS.growth] },
    scrapedAt: scraped?.scraped_at,
    sourceUrl: scraped?.url ?? input.websiteUrl,
  };
}

/** Convenience wrapper for production callers. */
export async function runAnalysis(input: AnalyzeInput): Promise<DraftedProfile> {
  return analyzeBrand(input, {
    researcher: getResearcher(),
    llm: getLLMProvider(),
  });
}
