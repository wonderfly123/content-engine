/**
 * A brand's editor style, stored as versions per section (table editor_style_versions). Saves only
 * ever add rows; restore and reset add one too. Callers check the brand first (requireBrand); every
 * query here is scoped to that brand.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { compileStyle, styleBytes } from "./style-compile";
import { defaultSection, defaultStyle } from "./style-defaults";
import {
  MAX_STYLE_BYTES,
  MAX_STYLE_NOTE_CHARS,
  STYLE_SECTION_IDS,
  isStyleSection,
  parseSectionValue,
  sameValue,
  sectionDef,
  type EditorStyle,
  type SectionValue,
  type StyleSectionId,
} from "./style-schema";

const { editorStyleVersions: versions } = schema;
type Row = typeof versions.$inferSelect;

/** A refused change; the message is safe to show. */
export class StyleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleError";
  }
}

export interface BrandRef {
  workspaceId: string;
  brandId: string;
}

async function newestRows(brandId: string): Promise<Map<string, Row>> {
  const rows = await db
    .selectDistinctOn([versions.section])
    .from(versions)
    .where(eq(versions.brandId, brandId))
    .orderBy(versions.section, desc(versions.createdAt), desc(versions.id));
  return new Map(rows.map((r) => [r.section, r]));
}

function valueOf(id: StyleSectionId, row: Row | undefined): SectionValue {
  const fallback = defaultSection(id);
  if (!row) return fallback;
  const parsed = parseSectionValue(id, row.value, fallback);
  return parsed.ok ? parsed.value : fallback;
}

/** The brand's current style: each section's newest version, else its default. */
export async function currentStyle(brandId: string): Promise<EditorStyle> {
  const newest = await newestRows(brandId);
  return Object.fromEntries(STYLE_SECTION_IDS.map((id) => [id, valueOf(id, newest.get(id))])) as EditorStyle;
}

/** The brand's compiled style.md, or null when it changed nothing. */
export async function brandStyleFile(brandId: string, brandName: string): Promise<string | null> {
  return compileStyle(await currentStyle(brandId), brandName);
}

export interface StyleSectionView {
  id: StyleSectionId;
  value: SectionValue;
  changed: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Starting text for "How you sound" and "Facts it may use", from the brand's Persona & Voice. */
export interface BrandPrefill {
  voice: string;
  facts: string;
}

/**
 * Every section with its current value. A brand section never saved shows the brand's own voice and
 * facts (`prefill`) instead of empty boxes; that is display only, so its jobs still run as before.
 */
export async function styleOverview(
  brandId: string,
  nameOf: (userId: string | null) => string = (id) => id ?? "the app",
  prefill?: BrandPrefill,
): Promise<StyleSectionView[]> {
  const newest = await newestRows(brandId);
  const defaults = defaultStyle();
  return STYLE_SECTION_IDS.map((id) => {
    const row = newest.get(id);
    let value = valueOf(id, row);
    const changed = !sameValue(value, defaults[id]);
    if (id === "brand" && !row && prefill) value = { ...value, picks: { ...value.picks, voice: prefill.voice, facts: prefill.facts } };
    return {
      id,
      value,
      changed,
      updatedAt: row ? row.createdAt.toISOString() : null,
      updatedBy: row ? nameOf(row.createdBy) : null,
    };
  });
}

/** A section's saved versions, newest first. */
export async function styleHistory(brandId: string, section: StyleSectionId, limit = 50): Promise<Row[]> {
  return db
    .select()
    .from(versions)
    .where(and(eq(versions.brandId, brandId), eq(versions.section, section)))
    .orderBy(desc(versions.createdAt), desc(versions.id))
    .limit(limit);
}

/** Adds a version of one section. Refuses an unknown section, a bad value, or a style too big for a job. */
export async function saveStyleSection(input: BrandRef & { section: unknown; value: unknown; note?: unknown; userId: string | null; brandName?: string }): Promise<Row> {
  if (!isStyleSection(input.section)) throw new StyleError("That is not a section of the editor style.");
  const section = input.section;
  const parsed = parseSectionValue(section, input.value, defaultSection(section));
  if (!parsed.ok) throw new StyleError(parsed.error);
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > MAX_STYLE_NOTE_CHARS) throw new StyleError(`A note can be at most ${MAX_STYLE_NOTE_CHARS} characters.`);
  const next = { ...(await currentStyle(input.brandId)), [section]: parsed.value };
  if (styleBytes(compileStyle(next, input.brandName ?? "this brand")) > MAX_STYLE_BYTES) {
    throw new StyleError(`Your editor style is too long all together (at most ${MAX_STYLE_BYTES / 1024} KB). Shorten one of the text boxes.`);
  }
  const [row] = await db
    .insert(versions)
    .values({ workspaceId: input.workspaceId, brandId: input.brandId, section, value: parsed.value, note: note || null, createdBy: input.userId })
    .returning();
  return row;
}

/** Saves an earlier version of a section again, as its newest. */
export async function restoreStyleVersion(input: BrandRef & { section: unknown; versionId: unknown; userId: string; brandName?: string }): Promise<Row> {
  if (!isStyleSection(input.section)) throw new StyleError("That is not a section of the editor style.");
  if (typeof input.versionId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.versionId)) throw new StyleError("Unknown version.");
  const [old] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.id, input.versionId), eq(versions.brandId, input.brandId), eq(versions.section, input.section)))
    .limit(1);
  if (!old) throw new StyleError("Unknown version.");
  const when = old.createdAt.toISOString().slice(0, 16).replace("T", " ");
  return saveStyleSection({ ...input, value: old.value, note: `Restored the version from ${when} UTC` });
}

/** Saves a section's default as its newest version. */
export async function resetStyleSection(input: BrandRef & { section: unknown; userId: string; brandName?: string }): Promise<Row> {
  if (!isStyleSection(input.section)) throw new StyleError("That is not a section of the editor style.");
  return saveStyleSection({ ...input, value: defaultSection(input.section), note: "Reset to default" });
}

export const sectionTitle = (id: StyleSectionId): string => sectionDef(id).title;
