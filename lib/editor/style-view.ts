/**
 * What Settings > Editor style loads: every section with its current value, the brand's pending
 * suggestions, and whether the caller may edit the platform-wide Advanced steps. The caller has
 * already checked the brand (requireBrand).
 */
import type { Access } from "@/lib/auth/access";
import { namesFor } from "./skill-people";
import { pendingSuggestions, type StyleSuggestionView } from "./style-learning";
import type { SectionValue } from "./style-schema";
import { styleOverview, type StyleSectionView } from "./style-store";

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

export async function editorStyleResponse(brandId: string, me: Access): Promise<EditorStyleResponse> {
  const first = await styleOverview(brandId, (id) => id ?? "");
  const names = await namesFor(first.flatMap((s) => (s.updatedBy ? [s.updatedBy] : [])), me.userId);
  return {
    sections: first.map((s) => ({ ...s, updatedBy: s.updatedAt ? (s.updatedBy ? names(s.updatedBy) : SUGGESTION_AUTHOR) : null })),
    suggestions: await pendingSuggestions(brandId),
    canEditAdvanced: me.role === "admin" && me.status === "active",
  };
}
