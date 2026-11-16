/**
 * The brand's voice as one block of plain text for the editor worker, built from the same brand
 * fields the drafts pipeline uses (description, persona, voice settings, free-form voice, examples),
 * then the brand facts from onboarding as an explicit "use these, invent nothing else" list.
 */
import type { schema } from "@/lib/db";
import type { Voice } from "@/lib/db/types";

type BrandRow = typeof schema.brands.$inferSelect;

const MAX_CHARS = 6000;

export function brandVoice(brand: Pick<BrandRow, "description" | "personaJson" | "voiceJson" | "voiceFreeform" | "voiceExamples">): string {
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    const text = Array.isArray(value) ? value.filter(Boolean).join(", ") : typeof value === "string" ? value.trim() : "";
    if (text) lines.push(`${label}: ${text}`);
  };
  add("About", brand.description);
  const p = brand.personaJson ?? {};
  add("Mission", p.mission);
  add("Audience", p.audienceSummary);
  add("Archetype", p.archetype);
  add("Point of view", p.pointOfView);
  add("Traits", p.traits);
  const v = brand.voiceJson ?? {};
  const s = v.toneSliders ?? {};
  const tones = (
    [
      ["formal", "casual", s.formality],
      ["serious", "playful", s.playfulness],
      ["reserved", "bold", s.boldness],
      ["technical", "accessible", s.accessibility],
    ] as const
  )
    .filter(([, , n]) => typeof n === "number" && Math.abs(n) >= 20)
    .map(([lo, hi, n]) => ((n as number) > 0 ? hi : lo));
  add("Tone", tones);
  add("Emoji", v.emojiPolicy);
  add("Hashtags", v.hashtagStyle);
  add("Reading level", v.readingLevel);
  add("Never say", v.bannedWords);
  add("Signature phrases", v.signaturePhrases);
  add("Voice", brand.voiceFreeform);
  const examples = (brand.voiceExamples ?? []).slice(0, 3).map((e) => e.caption?.trim()).filter(Boolean);
  if (examples.length) lines.push(`Example captions:\n${examples.map((e) => `- ${e}`).join("\n")}`);
  // The facts go last and are never cut short by the length limit: the editor must see the whole list.
  const facts = brandFacts(v.facts);
  const main = lines.join("\n").slice(0, Math.max(0, MAX_CHARS - facts.length - (facts ? 1 : 0)));
  return [main, facts].filter(Boolean).join("\n");
}

const MAX_FACT_CHARS = 2500;

/** The brand facts as an explicit allow-list: the editor may use these and must not invent others. */
function brandFacts(facts: Voice["facts"]): string {
  // Brands set up before brand facts existed have none stored; their text is left as it was.
  if (!Array.isArray(facts)) return "";
  const items = (facts ?? []).map((f) => (typeof f?.fact === "string" ? f.fact.replace(/\s+/g, " ").trim() : "")).filter(Boolean);
  if (!items.length) return "Brand facts: none given. Do not mention any specific place, product, price, offer or name of the brand that is not in the footage or the request.";
  let out = "Brand facts you may use (never invent others; mention no place, product, price, offer or name of the brand that is not on this list):";
  for (const item of items) {
    const line = `\n- ${item}`;
    if (out.length + line.length > MAX_FACT_CHARS) break;
    out += line;
  }
  return out;
}
