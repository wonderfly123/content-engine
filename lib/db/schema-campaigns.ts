/**
 * Campaigns: one chat (a conversation of kind "campaign") that brainstorms with the editor, writes a
 * plan of many videos with a posting calendar, then makes them one at a time when the person says go.
 * Re-exported from ./schema.
 *
 * Separation: a campaign reaches its workspace directly (`workspace_id`) and through its brand, and
 * always belongs to one conversation of that workspace; it is only ever read through that
 * conversation (`requireConversation`). Plan items carry the brand too, like every brand table.
 */
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { brands, workspaces } from "./schema";
import { conversations } from "./schema-conversations";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    name: text().notNull().default(""),
    theme: text().notNull().default(""),
    goal: text().notNull().default(""),
    audience: text().notNull().default(""),
    /** When the editor first wrote the plan; null while still brainstorming. */
    planWrittenAt: timestamp("plan_written_at", { withTimezone: true }),
    /** When the person approved the plan's posting calendar (once). */
    calendarApprovedAt: timestamp("calendar_approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("campaigns_conversation_unique").on(t.conversationId), index("campaigns_brand_idx").on(t.brandId)],
);

/**
 * One planned video. Its status (planned / editing / ready / approved / scheduled / posted) is not
 * stored: it comes from its editor jobs (`editor_jobs.campaign_item_id`) and the post they made.
 */
export const campaignItems = pgTable(
  "campaign_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** 1-based, in posting order: "#4" in chat. */
    position: integer().notNull(),
    title: text().notNull(),
    angle: text().notNull().default(""),
    hook: text().notNull().default(""),
    /** 15, 30 or 60. */
    lengthSec: integer("length_sec").notNull(),
    /** "reel" or "story". */
    format: text().notNull(),
    music: text().notNull().default(""),
    /** Library clips (assets of the same brand) the video would use. */
    assetIds: jsonb("asset_ids").$type<string[]>().notNull().default([]),
    postAt: timestamp("post_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaign_items_campaign_idx").on(t.campaignId, t.position)],
);
