/**
 * What Settings > Editor style loads: every section with its current value, the brand's pending
 * suggestions, and whether the caller may edit the platform-wide Advanced steps. The caller has
 * already checked the brand (requireBrand).
 */
import { eq } from "drizzle-orm";
import type { Access } from "@/lib/auth/access";
import { db, schema } from "@/lib/db";
import type { Voice } from "@/lib/db/types";
import { namesFor } from "./skill-people";
import { pendingSuggestions, type StyleSuggestionView } from "./style-learning";
import type { SectionValue } from "./style-schema";
import { styleOverview, type BrandPrefill, type StyleSectionView } from "./style-store";

export interface EditorStyleResponse {
  sections: StyleSectionView[];
  suggestions: StyleSuggestionView[];
  /** Only the platform admin edits the technical steps (Advanced). */
  canEditAdvanced: boolean;
}

/** One saved version of a section, as the history list shows it. */
export interface StyleVersionView {
  id: string;
  createdAt: string;
  createdBy: string;
  note: string | null;
  value: SectionValue;
  isDefault: boolean;
}

export const SUGGESTION_AUTHOR = "Accepted suggestion";

/** The brand's Persona & Voice text, to start the voice and facts boxes from. */
async function brandPrefill(brandId: string): Promise<BrandPrefill | undefined> {
  const [b] = await db
    .select({ voiceFreeform: schema.brands.voiceFreeform, voiceJson: schema.brands.voiceJson })
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  if (!b) return undefined;
  const facts = ((b.voiceJson as Voice | null)?.facts ?? []).map((f) => f.fact?.trim()).filter(Boolean);
  return { voice: b.voiceFreeform.trim(), facts: facts.join("\n") };
}

export async function editorStyleResponse(brandId: string, me: Access): Promise<EditorStyleResponse> {
  const first = await styleOverview(brandId, (id) => id ?? "", await brandPrefill(brandId));
  const names = await namesFor(first.flatMap((s) => (s.updatedBy ? [s.updatedBy] : [])), me.userId);
  return {
    sections: first.map((s) => ({ ...s, updatedBy: s.updatedAt ? (s.updatedBy ? names(s.updatedBy) : SUGGESTION_AUTHOR) : null })),
    suggestions: await pendingSuggestions(brandId),
    canEditAdvanced: me.role === "admin" && me.status === "active",
  };
}
