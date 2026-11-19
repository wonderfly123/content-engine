/**
 * The shape of a brand's editor style (Settings > Editor style): ten sections, each a few quick
 * picks plus a free-text box. The field list drives the form, the checks and the compiled style.md.
 * Defaults live in ./style-defaults.ts (derived from the skill markdown). Safe to import from client code.
 */
import { z } from "zod";

export const STYLE_SECTION_IDS = ["brand", "opener", "shots", "pacing", "structure", "lengths", "sound", "captions", "footage", "never"] as const;
export type StyleSectionId = (typeof STYLE_SECTION_IDS)[number];

export const isStyleSection = (v: unknown): v is StyleSectionId => typeof v === "string" && (STYLE_SECTION_IDS as readonly string[]).includes(v);

export const MAX_NOTES_CHARS = 6000;
export const MAX_STYLE_NOTE_CHARS = 500;
export const MAX_ITEM_CHARS = 160;
export const MAX_LIST_ITEMS = 20;
export const MAX_FOOTAGE_TYPES = 6;
/** Largest compiled style.md a job may carry (same as MAX_STYLE_BYTES in workers/editor/contract.py). */
export const MAX_STYLE_BYTES = 64 * 1024;

interface Option {
  value: string;
  label: string;
}

export type StyleField =
  | { kind: "select"; key: string; label: string; options: Option[]; hint?: string }
  | { kind: "pills"; key: string; label: string; options: Option[]; hint?: string }
  | { kind: "tags"; key: string; label: string; placeholder: string; hint?: string }
  | { kind: "ranked"; key: string; label: string; placeholder: string; hint?: string }
  | { kind: "slider"; key: string; label: string; min: number; max: number; unit: string; hint?: string }
  | { kind: "toggle"; key: string; label: string; hint?: string; comingSoon?: boolean }
  | { kind: "text"; key: string; label: string; placeholder: string; hint?: string }
  | { kind: "longtext"; key: string; label: string; placeholder: string; hint?: string };

export interface FootageType {
  id: string;
  name: string;
  builtIn: boolean;
  /** When the editor should treat footage as this type. */
  when: string;
  /** What makes a shot worth using, strongest first. */
  ranked: string[];
  pacing: string;
  notes: string;
}

export type PickValue = string | number | boolean | string[] | FootageType[];
export interface SectionValue {
  picks: Record<string, PickValue>;
  notes: string;
}
export type EditorStyle = Record<StyleSectionId, SectionValue>;

export interface SectionDef {
  id: StyleSectionId;
  number: number;
  title: string;
  /** One friendly line under the title. */
  blurb: string;
  fields: StyleField[];
  notesLabel: string;
}

const opts = (...pairs: Array<[string, string]>): Option[] => pairs.map(([value, label]) => ({ value, label }));
const same = (...values: string[]): Option[] => values.map((v) => ({ value: v, label: v }));
const AUTO = "auto";

export const SECTIONS: SectionDef[] = [
  {
    id: "brand",
    number: 1,
    title: "Brand & story",
    blurb: "Who you are and what the editor may say about you.",
    notesLabel: "How the editor tells your story",
    fields: [
      { kind: "longtext", key: "voice", label: "How you sound", placeholder: "Friendly, a bit dry, never salesy", hint: "Adds to the voice in Persona & Voice." },
      { kind: "longtext", key: "facts", label: "Facts it may use", placeholder: "Family-run since 2019. Every coconut is cut to order." },
      { kind: "tags", key: "neverSay", label: "Words to never say", placeholder: "Add a word and press Enter" },
    ],
  },
  {
    id: "opener",
    number: 2,
    title: "Opener",
    blurb: "The first one to two seconds, and the words on screen.",
    notesLabel: "What makes a good opener",
    fields: [
      {
        kind: "select",
        key: "firstShot",
        label: "First shot shows",
        options: opts([AUTO, "Let the editor choose (finished result for builds, peak moment for events)"], ["result", "The finished result"], ["peak", "The peak moment"], ["before", "A before shot"]),
      },
      {
        kind: "pills",
        key: "textStyles",
        label: "On-screen text styles you like",
        hint: "None picked means a mix.",
        options: same("A number first", "Before and after", "Behind the scenes", "A question", "It's not A, it's B", "Guess the number", "Mistakes and cost"),
      },
      { kind: "slider", key: "maxWords", label: "Most words on screen", min: 3, max: 12, unit: "words" },
      { kind: "tags", key: "examples", label: "Openers you liked", placeholder: "Paste one and press Enter" },
    ],
  },
  {
    id: "shots",
    number: 3,
    title: "What makes a good shot",
    blurb: "What the editor looks for in your clips, and what it leaves out.",
    notesLabel: "Choosing the part of a clip",
    fields: [
      { kind: "ranked", key: "ranked", label: "Best shots, strongest first", placeholder: "Add a kind of shot", hint: "A footage type below can have its own order." },
      { kind: "tags", key: "skip", label: "Skip", placeholder: "Add something to leave out" },
      { kind: "toggle", key: "startAtMoment", label: "Start each shot just before the action, never at the start of the clip" },
    ],
  },
  {
    id: "pacing",
    number: 4,
    title: "Pacing & speed",
    blurb: "How long each shot lasts, and when to speed things up.",
    notesLabel: "More on pacing",
    fields: [
      { kind: "text", key: "shot15", label: "Shot length in a 15s video", placeholder: "about 1s" },
      { kind: "text", key: "shot30", label: "Shot length in a 30s video", placeholder: "1.5 to 2s" },
      { kind: "text", key: "shot45", label: "Shot length in a 45s video", placeholder: "2 to 3s" },
      { kind: "text", key: "shot60", label: "Shot length in a 60s video", placeholder: "2.5 to 3.5s" },
      {
        kind: "pills",
        key: "speedUp",
        label: "Speed up only",
        options: same("Pans across the subject", "Setup and loading stretches", "Long assembly stretches", "Long locked-off crowd shots"),
      },
      { kind: "slider", key: "maxSpedUp", label: "Most sped-up shots in a 15s video", min: 0, max: 8, unit: "shots" },
      { kind: "toggle", key: "realSpeedPeople", label: "Keep people at real speed" },
    ],
  },
  {
    id: "structure",
    number: 5,
    title: "Structure",
    blurb: "The order of the story and how it ends.",
    notesLabel: "More on structure",
    fields: [
      { kind: "select", key: "order", label: "Order", options: opts([AUTO, "By footage type (builds in order, events loose)"], ["chronological", "In the order it happened"], ["best-first", "Best moments first"]) },
      { kind: "select", key: "ending", label: "Ending", options: opts([AUTO, "By footage type"], ["result", "The finished result from a new angle"], ["reaction", "A last reaction"]) },
      { kind: "select", key: "screenTime", label: "Screen time per part", options: opts([AUTO, "By footage type"], ["quality", "By how good each part is"], ["even", "Spread evenly"]) },
    ],
  },
  {
    id: "lengths",
    number: 6,
    title: "Lengths & formats",
    blurb: "What you get when you don't say a length.",
    notesLabel: "More on lengths",
    fields: [
      { kind: "pills", key: "reel", label: "A reel comes as", options: ["10", "15", "20", "30", "45", "60", "90"].map((s) => ({ value: s, label: `${s}s` })) },
      { kind: "select", key: "story", label: "A story is", options: ["10", "15", "20", "30"].map((s) => ({ value: s, label: `${s}s` })) },
      { kind: "select", key: "campaign", label: "A campaign video is (when the plan doesn't say)", options: ["15", "30", "60"].map((s) => ({ value: s, label: `${s}s` })) },
    ],
  },
  {
    id: "sound",
    number: 7,
    title: "Sound",
    blurb: "The feel of the music and how cuts follow it.",
    notesLabel: "More on sound",
    fields: [
      { kind: "pills", key: "mood", label: "Music mood", hint: "None picked lets the editor choose.", options: same("Upbeat", "Chill", "Cinematic", "Acoustic", "Trending") },
      { kind: "select", key: "cutOnBeat", label: "Cut on the beat", options: opts([AUTO, "Let the editor decide"], ["yes", "Yes"], ["no", "No"]) },
      { kind: "toggle", key: "effects", label: "Sound effects", comingSoon: true },
    ],
  },
  {
    id: "captions",
    number: 8,
    title: "Captions",
    blurb: "The post text under your reels.",
    notesLabel: "How captions are written",
    fields: [
      { kind: "select", key: "tone", label: "Tone", options: opts(["brand", "Your brand voice"], ["warm", "Warm"], ["playful", "Playful"], ["professional", "Professional"], ["plain", "Plain and simple"]) },
      { kind: "select", key: "length", label: "Length", options: opts(["short", "One short sentence"], ["medium", "2 to 3 sentences"], ["long", "A short paragraph"]) },
      { kind: "slider", key: "emojis", label: "Emojis", min: 0, max: 8, unit: "emojis" },
      { kind: "slider", key: "hashtags", label: "Hashtags", min: 0, max: 10, unit: "hashtags" },
      { kind: "tags", key: "fixedHashtags", label: "Always include", placeholder: "#yourbrand" },
      { kind: "text", key: "cta", label: "Call to action", placeholder: "Come say hi this weekend" },
    ],
  },
  {
    id: "footage",
    number: 9,
    title: "Footage types",
    blurb: "Different kinds of shoots, each with its own best shots and pacing.",
    notesLabel: "How the editor picks a type",
    fields: [],
  },
  {
    id: "never",
    number: 10,
    title: "Never do",
    blurb: "Hard rules the editor always follows.",
    notesLabel: "More hard rules",
    fields: [{ kind: "tags", key: "rules", label: "Never", placeholder: "Add a rule and press Enter" }],
  },
];

export const sectionDef = (id: StyleSectionId): SectionDef => SECTIONS.find((s) => s.id === id)!;

// ---- checks -------------------------------------------------------------------------------------

const item = z.string().trim().min(1).max(MAX_ITEM_CHARS);
const list = (max = MAX_LIST_ITEMS) =>
  z
    .array(item)
    .max(max)
    .transform((xs) => xs.filter((x, i) => xs.indexOf(x) === i));
const enumOf = (options: Option[]) => z.enum(options.map((o) => o.value) as [string, ...string[]]);

function fieldSchema(f: StyleField): z.ZodTypeAny {
  switch (f.kind) {
    case "select":
      return enumOf(f.options);
    case "pills":
      return z.array(enumOf(f.options)).transform((xs) => f.options.map((o) => o.value).filter((v) => xs.includes(v)));
    case "tags":
      return list();
    case "ranked":
      return list(10);
    case "slider":
      return z.number().int().min(f.min).max(f.max);
    case "toggle":
      return z.boolean();
    case "text":
      return z.string().trim().max(200);
    case "longtext":
      return z.string().trim().max(1500);
  }
}

const footageTypeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  builtIn: z.boolean(),
  when: z.string().trim().max(600),
  ranked: list(10),
  pacing: z.string().trim().max(2000),
  notes: z.string().trim().max(3000),
});

function picksSchema(def: SectionDef) {
  if (def.id === "footage") {
    return z.object({
      types: z
        .array(footageTypeSchema)
        .min(1)
        .max(MAX_FOOTAGE_TYPES)
        .refine((ts) => new Set(ts.map((t) => t.id)).size === ts.length, "Each footage type needs its own name."),
    }).strict();
  }
  return z.object(Object.fromEntries(def.fields.map((f) => [f.key, fieldSchema(f)]))).strict();
}

/**
 * Checks a section value, filling picks it lacks from `fallback` (so values saved before a pick
 * existed still load). Returns the clean value or a message safe to show.
 */
export function parseSectionValue(id: StyleSectionId, raw: unknown, fallback: SectionValue): { ok: true; value: SectionValue } | { ok: false; error: string } {
  const def = sectionDef(id);
  const obj = (raw && typeof raw === "object" ? raw : {}) as { picks?: unknown; notes?: unknown };
  const picks = { ...fallback.picks, ...(obj.picks && typeof obj.picks === "object" ? (obj.picks as Record<string, unknown>) : {}) };
  const parsed = z
    .object({ picks: picksSchema(def), notes: z.string().max(MAX_NOTES_CHARS, `The text box can hold at most ${MAX_NOTES_CHARS} characters.`) })
    .safeParse({ picks, notes: typeof obj.notes === "string" ? obj.notes : fallback.notes });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message && !/^(Expected|Invalid|Required|Unrecognized)/.test(first.message) ? first.message : `Something in ${def.title} isn't valid.` };
  }
  return { ok: true, value: { picks: parsed.data.picks as Record<string, PickValue>, notes: parsed.data.notes.replace(/\r\n/g, "\n") } };
}

/** Stable comparison of two section values. */
export const sameValue = (a: SectionValue, b: SectionValue): boolean => JSON.stringify(a) === JSON.stringify(b);
