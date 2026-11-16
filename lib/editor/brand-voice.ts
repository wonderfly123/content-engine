/**
 * The brand's voice as one block of plain text for the editor worker, built from the same brand
 * fields the drafts pipeline uses (description, persona, voice settings, free-form voice, examples).
 */
import type { schema } from "@/lib/db";

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
  return lines.join("\n").slice(0, MAX_CHARS);
}
