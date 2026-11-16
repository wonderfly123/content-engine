/**
 * What the review form starts with: the brand's saved profile once it has been reviewed, else the
 * research draft, else what they typed.
 */
import type { schema } from "@/lib/db";
import { flowStateOf } from "./flow";
import type { ReviewInput } from "./flow-schemas";

type BrandRow = typeof schema.brands.$inferSelect;

export function reviewInitial(brand: Pick<BrandRow, "name" | "websiteUrl" | "description" | "personaJson" | "voiceJson" | "voiceFreeform" | "voiceExamples" | "settingsJson">): ReviewInput {
  const state = flowStateOf(brand.settingsJson);
  const handle = typeof brand.settingsJson?.instagramHandle === "string" ? brand.settingsJson.instagramHandle : state.about?.instagramHandle;
  const base = { name: brand.name, websiteUrl: brand.websiteUrl ?? "", instagramHandle: handle ?? "" };

  if (brand.voiceJson?.facts) {
    return {
      ...base,
      whatTheyDo: brand.personaJson?.mission || brand.description,
      whoItsFor: brand.personaJson?.audienceSummary ?? "",
      tone: brand.voiceFreeform,
      wordsTheyUse: brand.voiceJson.signaturePhrases ?? [],
      wordsToAvoid: brand.voiceJson.bannedWords ?? [],
      facts: brand.voiceJson.facts.map((f) => ({ fact: f.fact, source: f.source ?? "" })),
      exampleCaptions: (brand.voiceExamples ?? []).map((e) => e.caption).filter(Boolean).slice(0, 5),
    };
  }

  const p = state.draft?.profile;
  return {
    ...base,
    whatTheyDo: p?.whatTheyDo || state.about?.summary || brand.description,
    whoItsFor: p?.whoItsFor ?? "",
    tone: p?.voice.tone ?? "",
    wordsTheyUse: p?.voice.wordsTheyUse ?? [],
    wordsToAvoid: p?.voice.wordsToAvoid ?? [],
    facts: p?.facts ?? [],
    exampleCaptions: p?.exampleCaptions ?? [],
  };
}
