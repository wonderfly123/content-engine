/**
 * Seed script: creates one "Wonderfly" test brand with a persona stub,
 * default voice settings, one default ICP, and a Growth cadence preset.
 *
 * Run with: `npm run db:seed`
 *
 * Requires DATABASE_URL and TOKEN_ENCRYPTION_KEY (the latter only if you
 * later add encrypted-column seeds; not used here).
 */

import { config as loadEnv } from "dotenv";
import { db } from "./index";
import { brands, cadenceSettings, icps } from "./schema";
import type { BrandSettings, Persona, Voice } from "./types";

async function main(): Promise<void> {
  loadEnv();

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Create a .env file with DATABASE_URL=... " +
        "and try again.",
    );
    process.exit(1);
  }

  console.log("Seeding Wonderfly brand…");

  const persona: Persona = {
    mission: "Build the best technical apparel for athletes who think.",
    audienceSummary:
      "Competitive endurance athletes who care about gear engineering as much as training.",
    archetype: "The Engineer",
    pointOfView:
      "Performance is earned through deliberate practice and precise tools.",
    traits: ["confident", "technical", "no-fluff", "evidence-driven"],
  };

  const voice: Voice = {
    toneSliders: {
      formality: -20,
      playfulness: -10,
      boldness: 60,
      accessibility: 10,
    },
    emojiPolicy: "sparse",
    hashtagStyle: "minimal",
    readingLevel: "8th grade",
    bannedWords: ["synergy", "leverage", "unlock"],
    signaturePhrases: [],
  };

  const settings: BrandSettings = {};

  const [brand] = await db
    .insert(brands)
    .values({
      name: "Wonderfly",
      slug: "wonderfly",
      status: "active",
      description: "Technical athletic apparel for endurance athletes.",
      personaJson: persona,
      voiceJson: voice,
      voiceFreeform: "Confident, technical, no fluff.",
      voiceExamples: [],
      settingsJson: settings,
    })
    .returning({ id: brands.id });

  if (!brand) throw new Error("Failed to insert brand row.");

  await db.insert(icps).values({
    brandId: brand.id,
    name: "Endurance Engineer",
    description:
      "30-45yo amateur endurance athlete with a technical day job.",
    painPoints: [
      "Gear that hides its trade-offs",
      "Marketing fluff instead of test data",
      "Sizing inconsistencies across brands",
    ],
    whereTheyHangOut:
      "Strava clubs, r/AdvancedRunning, Slowtwitch forums, dedicated podcast feeds.",
    contentTheyEngageWith:
      "Deep-dive gear reviews with measurements, training data breakdowns, athlete physiology explainers.",
    isDefault: true,
  });

  // Growth preset: 5 Reels + 2 Carousels per week on Instagram.
  await db.insert(cadenceSettings).values([
    {
      brandId: brand.id,
      channel: "instagram",
      format: "reel",
      perWeek: 5,
      enabled: true,
    },
    {
      brandId: brand.id,
      channel: "instagram",
      format: "carousel",
      perWeek: 2,
      enabled: true,
    },
  ]);

  console.log(`Seeded brand ${brand.id} (Wonderfly) with 1 ICP + 2 cadence rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
