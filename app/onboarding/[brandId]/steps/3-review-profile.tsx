import type { Brand } from "../page";
import { ProfileForm } from "@/components/onboarding/profile-form";
import type { ProfileInput } from "@/lib/onboarding/types";
import type { DraftedProfile } from "@/lib/onboarding/analyze";

interface Step3Props {
  brand: Brand;
}

function fromBrand(brand: Brand): ProfileInput {
  const settings = (brand.settingsJson ?? {}) as {
    onboarding?: { draftProfile?: DraftedProfile };
  };
  const draft = settings.onboarding?.draftProfile?.profile;

  // Prefer current brand row data if it differs from defaults; otherwise fall
  // back to the LLM-drafted profile so Step 3 is pre-filled on first visit.
  const persona = (brand.personaJson ?? {}) as {
    mission?: string;
    audienceSummary?: string;
    archetype?: string;
    pointOfView?: string;
    traits?: string[];
  };
  const voice = (brand.voiceJson ?? {}) as {
    toneSliders?: Partial<Record<string, number>>;
    emojiPolicy?: string;
    hashtagStyle?: string;
    readingLevel?: string;
    bannedWords?: string[];
    signaturePhrases?: string[];
  };

  const archetype = (persona.archetype ?? draft?.archetype ?? "creator") as ProfileInput["archetype"];

  return {
    name: brand.name?.startsWith("draft-") || !brand.name ? draft?.name ?? "" : brand.name,
    slug: brand.slug?.startsWith("draft-") ? draft?.slug ?? "" : brand.slug,
    tagline: persona.mission ?? draft?.tagline ?? "",
    audienceSummary: persona.audienceSummary ?? draft?.audienceSummary ?? "",
    archetype,
    traits: persona.traits ?? draft?.traits ?? [],
    pointOfView: persona.pointOfView ?? draft?.pointOfView ?? "",
    toneSliders: {
      formality: voice.toneSliders?.formality ?? draft?.toneSliders.formality ?? 50,
      playfulness: voice.toneSliders?.playfulness ?? draft?.toneSliders.playfulness ?? 50,
      authority: voice.toneSliders?.authority ?? draft?.toneSliders.authority ?? 50,
      boldness: voice.toneSliders?.boldness ?? draft?.toneSliders.boldness ?? 50,
      wit: voice.toneSliders?.wit ?? draft?.toneSliders.wit ?? 50,
      verbosity: voice.toneSliders?.verbosity ?? draft?.toneSliders.verbosity ?? 50,
    },
    emojiPolicy: normalizeEmoji(voice.emojiPolicy) ?? draft?.emojiPolicy ?? "sparing",
    hashtagStyle: normalizeHashtag(voice.hashtagStyle) ?? draft?.hashtagStyle ?? "few-strategic",
    readingLevel: (voice.readingLevel as ProfileInput["readingLevel"]) ?? draft?.readingLevel ?? "general",
    bannedWords: voice.bannedWords ?? draft?.bannedWords ?? [],
    signaturePhrases: voice.signaturePhrases ?? draft?.signaturePhrases ?? [],
    voiceFreeform: brand.voiceFreeform || draft?.voiceFreeform || "",
    voiceExamples:
      (brand.voiceExamples ?? []).map((e) => ({
        caption: e.caption,
        url: typeof e.notes === "string" ? e.notes : undefined,
      })) || [],
  };
}

function normalizeEmoji(v?: string): ProfileInput["emojiPolicy"] | undefined {
  if (!v) return undefined;
  if (v === "frequent") return "liberal";
  if (v === "sparse") return "sparing";
  if (v === "none") return "none";
  if (v === "liberal" || v === "sparing") return v;
  return undefined;
}

function normalizeHashtag(v?: string): ProfileInput["hashtagStyle"] | undefined {
  if (!v) return undefined;
  if (v === "heavy") return "many-broad";
  if (v === "moderate" || v === "minimal") return "few-strategic";
  if (v === "none") return "none";
  if (v === "few-strategic" || v === "many-broad") return v;
  return undefined;
}

export function Step3ReviewProfile({ brand }: Step3Props) {
  const initial = fromBrand(brand);
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">Review brand profile</h2>
        <p className="text-sm text-muted-foreground">
          Pre-filled from the analysis. Edit anything; nothing is final.
        </p>
      </header>
      <ProfileForm brandId={brand.id} initial={initial} />
    </div>
  );
}
