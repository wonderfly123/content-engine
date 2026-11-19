/**
 * A brand's editor style -> the job's `style.md`, plus a pointer appended to SKILL.md telling the
 * editor to follow it over the taste defaults. Only sections that differ from the default are
 * written; a brand that changed nothing gets no style.md and an untouched SKILL.md, so its jobs run
 * exactly as before. Safe to import from client code.
 */
import { defaultStyle } from "./style-defaults";
import { SECTIONS, sameValue, type EditorStyle, type FootageType, type SectionDef, type SectionValue, type StyleField } from "./style-schema";
import { utf8Bytes } from "./skill-files";

export const STYLE_FILE = "style.md";

/** Appended to SKILL.md in the job when the brand has a style.md. */
export const STYLE_POINTER =
  "\n\n## Brand style (this job)\n\n" +
  "This brand set its own editing style: read `style.md` right after the brief. Where it differs from `intake.md`,\n" +
  "`hooks.md`, `captions.md` or the profiles, `style.md` wins (the request still wins over both). The technical steps,\n" +
  "the folder rules and the manifest format above never change, whatever `style.md` says.\n";

function pick(field: StyleField, value: unknown): string | null {
  switch (field.kind) {
    case "select":
      return `${field.label}: ${field.options.find((o) => o.value === value)?.label ?? String(value)}`;
    case "pills": {
      const labels = (value as string[]).map((v) => field.options.find((o) => o.value === v)?.label ?? v);
      return `${field.label}: ${labels.length ? labels.join(", ") : "none picked"}${!labels.length && field.hint ? ` (${field.hint.replace(/\.$/, "")})` : ""}`;
    }
    case "tags":
    case "ranked": {
      const xs = value as string[];
      if (!xs.length) return `${field.label}: none`;
      return `${field.label}:\n${xs.map((x, i) => (field.kind === "ranked" ? `${i + 1}. ${x}` : `- ${x}`)).join("\n")}`;
    }
    case "slider":
      return `${field.label}: ${value} ${field.unit}`;
    case "toggle":
      return field.comingSoon ? null : `${field.label}: ${value ? "yes" : "no"}`;
    case "text":
    case "longtext":
      return `${field.label}: ${String(value).trim() || "(left blank)"}`;
  }
}

function footageType(t: FootageType): string {
  const lines = [`### ${t.name}${t.builtIn ? "" : " (added by the brand)"}`];
  if (t.when.trim()) lines.push(`Use when: ${t.when.trim()}`);
  if (t.ranked.length) lines.push(`Best shots, strongest first:\n${t.ranked.map((x, i) => `${i + 1}. ${x}`).join("\n")}`);
  if (t.pacing.trim()) lines.push(`Pacing:\n${t.pacing.trim()}`);
  if (t.notes.trim()) lines.push(`More:\n${t.notes.trim()}`);
  return lines.join("\n\n");
}

function section(def: SectionDef, value: SectionValue): string {
  const parts = [`## ${def.number}. ${def.title}`];
  if (def.id === "footage") {
    const types = value.picks.types as FootageType[];
    parts.push(
      `Footage types for this brand: ${types.map((t) => t.name).join(", ")}. Pick the type that fits the footage (instead of only build or event recap); ` +
        "a type's best shots and pacing replace the matching profile for that cut. A type without its own profile file follows these notes and `profiles/build.md` for anything they leave open.",
    );
    parts.push(...types.map(footageType));
  } else {
    const picks = def.fields.map((f) => pick(f, value.picks[f.key])).filter((x): x is string => x !== null);
    if (picks.length) parts.push(picks.join("\n"));
  }
  if (value.notes.trim()) parts.push(`Notes:\n${value.notes.trim()}`);
  return parts.join("\n\n");
}

/** The style.md for a brand, or null when every section is the default. */
export function compileStyle(style: EditorStyle, brandName: string): string | null {
  const defaults = defaultStyle();
  const changed = SECTIONS.filter((def) => !sameValue(style[def.id], defaults[def.id]));
  if (!changed.length) return null;
  const head =
    `# Editing style for ${brandName.replace(/\s+/g, " ").trim()}\n\n` +
    "The brand set these in the app. Each section below replaces the matching defaults in `intake.md`, `hooks.md`,\n" +
    "`captions.md` and the profiles; anything not listed here stays as those files say. Facts listed here may be used in\n" +
    "hooks and captions. Nothing here changes the technical steps, the folder rules or the manifest format.";
  return `${[head, ...changed.map((def) => section(def, style[def.id]))].join("\n\n")}\n`;
}

/** The job's skill files with the brand's style added (SKILL.md gets the pointer). Unchanged when `styleMd` is null. */
export function withBrandStyle(files: Record<string, string>, styleMd: string | null): Record<string, string> {
  if (!styleMd) return files;
  return { ...files, "SKILL.md": `${(files["SKILL.md"] ?? "").replace(/\s+$/, "")}${STYLE_POINTER}`, [STYLE_FILE]: styleMd };
}

export const styleBytes = (styleMd: string | null): number => (styleMd ? utf8Bytes(styleMd) : 0);
