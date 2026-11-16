/**
 * Conversations with the video editor: one thread per video, by text message and in the app.
 * Re-exported from ./schema, so `schema.conversations` etc. work like every other table.
 *
 * Separation: unlike the brand tables, a thread reaches its workspace directly (`workspace_id`),
 * because a thread can start before anyone has said which brand it is for. Every read or write of
 * a thread by id goes through `requireConversation` (lib/conversations/access.ts).
 * `member_phones` belongs to a user, not a workspace: a phone number identifies one person.
 */
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import {
  conversationKindEnum,
  conversationStatusEnum,
  messageChannelEnum,
  messageDirectionEnum,
} from "./enums";
import { brands, posts, workspaces } from "./schema";
import { editorJobs } from "./schema-editor";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const conversations = pgTable(
  "conversations",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null until the brand is known (asked once when the workspace has several). */
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    /** Null until the person says reel or story. */
    kind: conversationKindEnum(),
    status: conversationStatusEnum().notNull().default("open"),
    startedVia: messageChannelEnum("started_via").notNull(),
    /** Supabase auth user id of the person whose thread this is. */
    startedBy: uuid("started_by").notNull(),
    /** Set when the editor schedules a post; publishing that post closes the thread. */
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    /** Why it closed: "new_thread" (a new reel/story was started) or "published". */
    closedReason: text("closed_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("conversations_workspace_user_status_idx").on(t.workspaceId, t.startedBy, t.status),
    // At most one open thread per person per workspace.
    uniqueIndex("conversations_one_open_per_user")
      .on(t.workspaceId, t.startedBy)
      .where(sql`status = 'open'`),
    index("conversations_brand_idx").on(t.brandId, t.createdAt),
    index("conversations_post_idx").on(t.postId),
  ],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum().notNull(),
    channel: messageChannelEnum().notNull(),
    body: text().notNull(),
    /** Who wrote it; null for the app's own replies. */
    authorUserId: uuid("author_user_id"),
    /** Twilio's MessageSid for texts, so a retried webhook stores the message once. */
    providerMessageId: text("provider_message_id"),
    /** The editor job whose cuts this reply carries (lib/editor); null for every other message. */
    editorJobId: uuid("editor_job_id").references((): AnyPgColumn => editorJobs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversation_messages_provider_unique").on(t.providerMessageId),
    index("conversation_messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("conversation_messages_editor_job_idx").on(t.editorJobId),
  ],
);

export const memberPhones = pgTable(
  "member_phones",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    phoneE164: text("phone_e164").notNull(),
    /** Null until the 6-digit code is confirmed. Only confirmed numbers are recognised. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** SHA-256 of the pending code (never the code itself). */
    codeHash: text("code_hash"),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
    codeAttempts: integer("code_attempts").notNull().default(0),
    /** Rate limiting for code texts: the last send, and how many were sent in the current hour window. */
    lastCodeSentAt: timestamp("last_code_sent_at", { withTimezone: true }),
    codeWindowStartedAt: timestamp("code_window_started_at", { withTimezone: true }),
    codesSentInWindow: integer("codes_sent_in_window").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("member_phones_user_unique").on(t.userId),
    uniqueIndex("member_phones_phone_unique").on(t.phoneE164),
  ],
);
