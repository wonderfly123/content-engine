/**
 * The cloud video editor's jobs: one row per request sent to the editor worker (workers/editor on
 * Modal). Re-exported from ./schema.
 *
 * Separation: a job reaches its workspace directly (`workspace_id`) and always belongs to one
 * conversation of that workspace; it is only ever read through that conversation
 * (`requireConversation`), or by the worker's signed callback, which names the job.
 * At most one job per conversation is queued or running at a time.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { EditorManifest, EditorUsage } from "@/lib/editor/manifest";
import { editorJobKindEnum, editorJobStatusEnum } from "./enums";
import { brands, workspaces } from "./schema";
import { conversationMessages, conversations } from "./schema-conversations";

export const editorJobs = pgTable(
  "editor_jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    kind: editorJobKindEnum("kind").notNull(),
    status: editorJobStatusEnum("status").notNull().default("queued"),
    /** The message that asked for this edit. */
    triggerMessageId: uuid("trigger_message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
    /** What the person asked for, as sent to the worker. */
    request: text("request").notNull().default(""),
    model: text("model").notNull(),
    /** The worker's manifest, with each cut's preview media id added; null until done. */
    manifest: jsonb("manifest").$type<EditorManifest>(),
    usage: jsonb("usage").$type<EditorUsage>(),
    /** The job's real AI cost in US dollars, as the worker measured it. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("editor_jobs_conversation_idx").on(t.conversationId, t.createdAt),
    index("editor_jobs_workspace_idx").on(t.workspaceId),
    index("editor_jobs_status_idx").on(t.status, t.startedAt),
    // At most one job in flight per conversation.
    uniqueIndex("editor_jobs_one_active_per_conversation")
      .on(t.conversationId)
      .where(sql`status in ('queued', 'running')`),
  ],
);

/**
 * The editor skill's markdown files as edited in Admin (platform-wide, platform admin only).
 * Every save adds a row; a file's current version is its newest row, and a file with no rows is the
 * repo copy (workers/editor/skill, bundled in lib/editor/skill-defaults.generated.ts).
 */
export const editorSkillVersions = pgTable(
  "editor_skill_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Path inside the skill folder, one of EDITABLE_SKILL_PATHS (lib/editor/skill-files.ts). */
    path: text("path").notNull(),
    content: text("content").notNull(),
    /** The admin who saved it (Supabase auth user id). */
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    note: text("note"),
  },
  (t) => [index("editor_skill_versions_path_idx").on(t.path, t.createdAt)],
);
