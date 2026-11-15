/**
 * Step 2 orchestrator: turn a brand description into a drafted brand profile
 * (persona, voice freeform, default ICP, cadence preset).
 *
 * Pure, dependency-injectable: takes an `LLMProvider` so tests can supply a
 * stub. Production callers use `runAnalysis(brandId, input)`, which uses the
 * workspace's own LLM key.
 */

import type { LLMProvider, PersonaDraft } from "@/lib/llm/types";
import { llmForBrand } from "@/lib/credentials/clients";
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
  sourceUrl?: string;
}

export interface AnalyzeDeps {
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
 *  1. Call LLMProvider.extractPersona on the description for a structured persona
 *  2. Compose ProfileInput + ICP + Growth cadence preset
 *
 * The website address is not read; it only supplies the provisional brand name.
 */
export async function analyzeBrand(
  input: AnalyzeInput,
  deps: AnalyzeDeps,
): Promise<DraftedProfile> {
  if (!input.websiteUrl && !input.description) {
    throw new Error("analyzeBrand requires websiteUrl or description");
  }

  if (!input.description) {
    throw new Error("Add a description of the brand so it can be analysed.");
  }

  const persona = await deps.llm.extractPersona(
    `User-provided description:\n${input.description}`,
  );

  const name = input.websiteUrl
    ? new URL(input.websiteUrl).hostname.replace(/^www\./, "")
    : "New brand";

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
    sourceUrl: input.websiteUrl,
  };
}

/** Production entry point: analyses with the keys of the workspace that owns `brandId`. */
export async function runAnalysis(brandId: string, input: AnalyzeInput): Promise<DraftedProfile> {
  return analyzeBrand(input, { llm: await llmForBrand(brandId) });
}
