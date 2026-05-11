/**
 * Wizard step DTOs and Zod schemas.
 *
 * The onboarding wizard is a series of 8 steps; each has its own server
 * action consuming validated input from these schemas. We export both Zod
 * schemas (runtime validation at the boundary) and the inferred TS types so
 * components and actions share a single source of truth.
 */

import { z } from "zod";
import {
  brandStatusValues,
  channelValues,
  competitorPlatformValues,
  formatValues,
} from "@/lib/db/enums";

// ---- Step 1: create brand from website/description ------------------------

export const createBrandSchema = z
  .object({
    websiteUrl: z
      .string()
      .trim()
      .url("Must be a valid URL (e.g. https://example.com)")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    description: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .refine((v) => Boolean(v.websiteUrl || v.description), {
    message: "Provide a website URL, a description, or both.",
    path: ["websiteUrl"],
  });

export type CreateBrandInput = z.infer<typeof createBrandSchema>;

// ---- Step 3: brand profile ------------------------------------------------

const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(60)
    .regex(
      slugRegex,
      "Slug must be lowercase letters, digits and hyphens only",
    ),
  tagline: z.string().trim().max(280).optional().default(""),
  audienceSummary: z.string().trim().max(2000).optional().default(""),
  archetype: z.enum([
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
  ]),
  traits: z.array(z.string().trim().min(1)).max(20).default([]),
  pointOfView: z.string().trim().max(2000).optional().default(""),
  toneSliders: z
    .object({
      formality: z.number().min(0).max(100),
      playfulness: z.number().min(0).max(100),
      authority: z.number().min(0).max(100),
      boldness: z.number().min(0).max(100),
      wit: z.number().min(0).max(100),
      verbosity: z.number().min(0).max(100),
    })
    .default({
      formality: 50,
      playfulness: 50,
      authority: 50,
      boldness: 50,
      wit: 50,
      verbosity: 50,
    }),
  emojiPolicy: z.enum(["none", "sparing", "liberal"]).default("sparing"),
  hashtagStyle: z
    .enum(["none", "few-strategic", "many-broad"])
    .default("few-strategic"),
  readingLevel: z
    .enum(["grade-school", "middle-school", "general", "college"])
    .default("general"),
  bannedWords: z.array(z.string().trim().min(1)).max(50).default([]),
  signaturePhrases: z.array(z.string().trim().min(1)).max(50).default([]),
  voiceFreeform: z.string().trim().max(8000).optional().default(""),
  voiceExamples: z
    .array(
      z.object({
        caption: z.string().trim().min(1).max(4000),
        url: z
          .string()
          .trim()
          .url()
          .optional()
          .or(z.literal("").transform(() => undefined)),
      }),
    )
    .max(5)
    .default([]),
});

export type ProfileInput = z.infer<typeof profileSchema>;

// ---- Step 4: ICPs ---------------------------------------------------------

export const icpSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).default(""),
  painPoints: z.array(z.string().trim().min(1)).max(20).default([]),
  whereTheyHangOut: z.string().trim().max(2000).default(""),
  contentTheyEngageWith: z.string().trim().max(2000).default(""),
  isDefault: z.boolean().default(false),
});

export const icpsSchema = z
  .object({ icps: z.array(icpSchema).min(1, "At least one ICP is required").max(3) })
  .refine((v) => v.icps.filter((i) => i.isDefault).length <= 1, {
    message: "Only one ICP can be marked default",
    path: ["icps"],
  });

export type IcpInput = z.infer<typeof icpSchema>;
export type IcpsInput = z.infer<typeof icpsSchema>;

// ---- Step 5: competitors + inspiration -----------------------------------

const accountSchema = z.object({
  id: z.string().uuid().optional(),
  handle: z.string().trim().min(1).max(120),
  platform: z.enum(competitorPlatformValues),
  url: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(2000).optional().default(""),
  pullWindowDays: z.number().int().min(1).max(365).default(30),
});

export const competitorsInspirationSchema = z.object({
  competitors: z.array(accountSchema).max(10).default([]),
  inspiration: z.array(accountSchema).max(10).default([]),
});

export type AccountInput = z.infer<typeof accountSchema>;
export type CompetitorsInspirationInput = z.infer<
  typeof competitorsInspirationSchema
>;

// ---- Step 6: cadence ------------------------------------------------------

export const cadenceRowSchema = z.object({
  channel: z.enum(channelValues),
  format: z.enum(formatValues),
  perWeek: z.number().int().min(0).max(50),
  enabled: z.boolean().default(true),
});

export const cadenceSchema = z.object({
  preset: z.enum(["sustainable", "growth", "aggressive", "custom"]),
  rows: z.array(cadenceRowSchema).default([]),
});

export type CadenceRowInput = z.infer<typeof cadenceRowSchema>;
export type CadenceInput = z.infer<typeof cadenceSchema>;

export const CADENCE_PRESETS: Record<
  "sustainable" | "growth" | "aggressive",
  CadenceRowInput[]
> = {
  sustainable: [
    { channel: "instagram", format: "reel", perWeek: 2, enabled: true },
    { channel: "instagram", format: "carousel", perWeek: 1, enabled: true },
  ],
  growth: [
    { channel: "instagram", format: "reel", perWeek: 5, enabled: true },
    { channel: "instagram", format: "carousel", perWeek: 2, enabled: true },
  ],
  aggressive: [
    { channel: "instagram", format: "reel", perWeek: 7, enabled: true },
    { channel: "instagram", format: "carousel", perWeek: 3, enabled: true },
    { channel: "instagram", format: "image", perWeek: 2, enabled: true },
  ],
};

// ---- shared ---------------------------------------------------------------

export const brandStatusSchema = z.enum(brandStatusValues);

/** Stored on `brands.settings_json` to track progress through the wizard. */
export interface OnboardingState {
  currentStep?: number;
  draftProfile?: unknown;
  preset?: "sustainable" | "growth" | "aggressive" | "custom";
}
