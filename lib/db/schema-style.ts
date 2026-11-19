/**
 * Per-brand editor style (Settings > Editor style): the brand's taste for the cloud video editor, in
 * ten sections. Re-exported from ./schema.
 *
 * - editor_style_versions: one row per save of one section. A section's current value is its newest
 *   row; a section with no rows uses the default derived from the skill markdown (lib/editor/style-defaults.ts).
 * - editor_style_suggestions: small tweaks the app proposes after an approval or a change request
 *   (lib/editor/style-learning.ts). At most one pending suggestion per brand and section.
 *
 * Separation: both carry the brand (and its workspace) and are only read through requireBrand.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { brands, workspaces } from "./schema";
import { conversations } from "./schema-conversations";
import { editorJobs } from "./schema-editor";

export const editorStyleVersions = pgTable(
  "editor_style_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** One of STYLE_SECTION_IDS (lib/editor/style-schema.ts). */
    section: text().notNull(),
    /** The section's value: { picks, notes } (or the footage types list); checked by the section's schema. */
    value: jsonb().notNull(),
    note: text(),
    /** Who saved it (Supabase auth user id); null when the app applied an accepted suggestion for nobody. */
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("editor_style_versions_brand_section_idx").on(t.brandId, t.section, t.createdAt)],
);

export const editorStyleSuggestions = pgTable(
  "editor_style_suggestions",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    section: text().notNull(),
    /** The tweak, one short line ("Keep on-screen text under 6 words"). */
    change: text().notNull(),
    /** Why, one short line. */
    reason: text().notNull().default(""),
    /** "approved" (a cut was approved) or "changes" (the person asked for changes). */
    source: text().notNull(),
    /** "pending", "accepted" or "dismissed". */
    status: text().notNull().default("pending"),
    editorJobId: uuid("editor_job_id").references(() => editorJobs.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
  },
  (t) => [
    uniqueIndex("editor_style_suggestions_pending_unique").on(t.brandId, t.section).where(sql`status = 'pending'`),
    index("editor_style_suggestions_brand_idx").on(t.brandId, t.createdAt),
    index("editor_style_suggestions_job_idx").on(t.editorJobId),
  ],
);
