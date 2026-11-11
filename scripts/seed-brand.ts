/**
 * Idempotent minimal-brand seeder.
 *
 * Creates an `active` brand row with placeholder persona/voice so it shows up
 * in the brand switcher and can connect Meta — but with NO cadence/ICP rows,
 * because these brands are for analytics-only, not content generation.
 *
 * Usage:
 *   npx tsx scripts/seed-brand.ts <slug> "<name>" [description]
 *
 * Idempotent: if a brand with that slug already exists, the script no-ops
 * and prints the existing id.
 */

import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import type { Persona, Voice, BrandSettings } from "@/lib/db/types";

async function main(): Promise<void> {
  loadEnv({ path: ".env.local" });
  loadEnv(); // fallback

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const [, , slug, name, ...descParts] = process.argv;
  const description = descParts.join(" ");
  if (!slug || !name) {
    console.error(
      'Usage: npx tsx scripts/seed-brand.ts <slug> "<name>" [description]',
    );
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.slug, slug));

  if (existing) {
    console.log(
      `Brand "${existing.name}" already exists with slug "${slug}" → id=${existing.id}`,
    );
    return;
  }

  const persona: Persona = {};
  const voice: Voice = {};
  const settings: BrandSettings = {};

  const [brand] = await db
    .insert(brands)
    .values({
      name,
      slug,
      status: "active",
      description: description || "",
      personaJson: persona,
      voiceJson: voice,
      voiceFreeform: "",
      voiceExamples: [],
      settingsJson: settings,
    })
    .returning({ id: brands.id });

  if (!brand) throw new Error("Insert returned no row.");

  console.log(`Seeded brand "${name}" (slug=${slug}) → id=${brand.id}`);
  console.log(
    `  Visit /onboarding/${brand.id}?step=7 to connect Meta for this brand.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
