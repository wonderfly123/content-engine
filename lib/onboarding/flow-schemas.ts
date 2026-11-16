/**
 * Validation for the onboarding flow: what each step submits, and what the research model must return.
 */
import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .pipe(z.string().url("Enter a web address, like example.com").or(z.literal("")))
  .optional()
  .transform((v) => v || undefined);

const handle = z
  .string()
  .trim()
  .max(31)
  .transform((v) => v.replace(/^@/, ""))
  .pipe(z.string().regex(/^[A-Za-z0-9._]{0,30}$/, "Instagram handles use letters, numbers, dots and underscores"))
  .optional()
  .transform((v) => v || undefined);

const caption = z.string().trim().min(1).max(2200);

// ---- Step 1 ----------------------------------------------------------------

export const welcomeSchema = z.object({
  fullName: z.string().trim().max(80).optional().transform((v) => v || undefined),
  brandName: z.string().trim().min(1, "Give the brand a name").max(120),
});
export type WelcomeInput = z.input<typeof welcomeSchema>;

// ---- Step 3 ----------------------------------------------------------------

export const aboutSchema = z.object({
  websiteUrl: optionalUrl,
  instagramHandle: handle,
  summary: z.string().trim().min(3, "Say in a sentence what the brand does").max(600),
  captions: z
    .array(z.string().trim().max(2200))
    .max(5)
    .default([])
    .transform((list) => list.filter(Boolean)),
});
export type AboutFormInput = z.input<typeof aboutSchema>;

// ---- Step 4: what the research model returns -------------------------------

/** A list that keeps its valid items (up to `max`) and silently drops the rest. */
function list<T extends z.ZodTypeAny>(max: number, item: T) {
  return z
    .array(z.unknown())
    .default([])
    .transform((raw) => raw.flatMap((x) => {
      const r = item.safeParse(x);
      return r.success ? [r.data as z.output<T>] : [];
    }).slice(0, max));
}
const word = z.string().trim().min(1).max(80);

/** Facts from the model must each name the source they came from. */
export const researchOutputSchema = z.object({
  whatTheyDo: z.string().trim().min(1).max(1000),
  whoItsFor: z.string().trim().max(1000).default(""),
  voice: z
    .object({
      tone: z.string().trim().max(2000).default(""),
      wordsTheyUse: list(30, word),
      wordsToAvoid: list(30, word),
    })
    .default({}),
  facts: list(40, z.object({ fact: z.string().trim().min(1).max(300), source: z.string().trim().min(1).max(500) })),
  exampleCaptions: list(5, caption),
});
export type ResearchOutput = z.infer<typeof researchOutputSchema>;

// ---- Step 5 ----------------------------------------------------------------

export const reviewSchema = z.object({
  name: z.string().trim().min(1, "The brand needs a name").max(120),
  websiteUrl: optionalUrl,
  instagramHandle: handle,
  whatTheyDo: z.string().trim().min(1, "Say what the brand does").max(1000),
  whoItsFor: z.string().trim().max(1000).default(""),
  tone: z.string().trim().max(2000).default(""),
  wordsTheyUse: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  wordsToAvoid: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  facts: z
    .array(z.object({ fact: z.string().trim().min(1, "A fact cannot be empty").max(300), source: z.string().trim().max(500).default("") }))
    .max(40)
    .default([]),
  exampleCaptions: z.array(caption).max(5).default([]),
});
export type ReviewInput = z.input<typeof reviewSchema>;
export type ReviewData = z.output<typeof reviewSchema>;
