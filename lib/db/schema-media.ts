/**
 * Media files on private storage (Cloudflare R2): raw clips uploaded into a conversation, and later
 * the editor's previews, finals, voice-overs and thumbnails. Re-exported from ./schema.
 *
 * Separation: a media object reaches its workspace directly (`workspace_id`), like a conversation,
 * and its storage key always starts with that workspace (lib/storage/keys.ts). Reads by id go
 * through `requireMedia` (lib/media/access.ts); uploads into a thread go through
 * `requireConversation` and must name a media object of that same thread.
 */
import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { mediaKindEnum, mediaStatusEnum } from "./enums";
import { brands, workspaces } from "./schema";
import { conversations } from "./schema-conversations";

export const mediaObjects = pgTable(
  "media_objects",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    kind: mediaKindEnum().notNull(),
    r2Key: text("r2_key").notNull(),
    filename: text().notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: mediaStatusEnum().notNull().default("uploading"),
    /** R2's multipart upload id while uploading; cleared once ready. */
    uploadId: text("upload_id"),
    /** Size as uploaded, before the optimizer shrank it (null until the upload completes). */
    originalSizeBytes: bigint("original_size_bytes", { mode: "number" }),
    /** Why optimizing did not happen (the original was kept); null when it worked or never ran. */
    optimizeError: text("optimize_error"),
    /** The optimizer job in flight for this object; the worker's callback must name it. */
    optimizeJobId: text("optimize_job_id"),
    /** Supabase auth user id of the uploader. */
    uploadedBy: uuid("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /** Set when the object is gone (cancelled, failed, or later removed); such rows do not count against storage. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("media_objects_r2_key_unique").on(t.r2Key),
    uniqueIndex("media_objects_optimize_job_id_unique").on(t.optimizeJobId),
    index("media_objects_conversation_idx").on(t.conversationId, t.createdAt),
    index("media_objects_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * Platform-wide settings the admin changes in Admin (one row per key), e.g. how long raw clips are
 * kept (lib/media/retention.ts). Not per workspace: only the platform admin reads or writes them.
 */
export const platformSettings = pgTable("platform_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
