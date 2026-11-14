"use server";

/**
 * Settings-tab server actions. Currently focused on Keywords (the one
 * brand-scoped surface that isn't covered by the onboarding action set).
 *
 * Other brand tabs reuse the existing actions in app/onboarding/[brandId]/actions.ts
 * (saveProfile, saveICPs, saveCompetitorsInspiration, saveCadence).
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { tryBrand, tryOwned } from "@/lib/auth/workspace";
import { db } from "@/lib/db";
import { brands, keywords, events, jobs } from "@/lib/db/schema";
import { channelValues } from "@/lib/db/enums";
import type { BrandSettings } from "@/lib/db/types";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const idSchema = z.string().uuid();

/**
 * The caller's access to a keyword, only when it belongs to the brand named in the same call.
 * Null for a keyword that is missing, someone else's, or filed under a different brand.
 */
async function ownedKeyword(input: { brandId: string; keywordId: string }) {
  const access = await tryOwned(keywords, input.keywordId);
  return access && access.brandId === input.brandId ? access : null;
}

const enabledChannelsSchema = z.array(z.enum(channelValues)).max(
  channelValues.length,
);

/**
 * Persists which channels are visible in analytics for a brand.
 * Stored as settings_json.enabledChannels; merged so other keys survive.
 */
export async function setEnabledChannels(input: {
  brandId: string;
  channels: string[];
}): Promise<ActionResult<undefined>> {
  if (!idSchema.safeParse(input.brandId).success) {
    return { ok: false, error: "Invalid brand id" };
  }
  const parsed = enabledChannelsSchema.safeParse(input.channels);
  if (!parsed.success) {
    return { ok: false, error: "Invalid channel list" };
  }
  const channels = Array.from(new Set(parsed.data));

  const access = await tryBrand(input.brandId);
  if (!access) return { ok: false, error: "Brand not found" };

  const [brand] = await db
    .select({ settingsJson: brands.settingsJson })
    .from(brands)
    .where(eq(brands.id, access.brandId))
    .limit(1);
  if (!brand) return { ok: false, error: "Brand not found" };

  const settings: BrandSettings = {
    ...((brand.settingsJson ?? {}) as BrandSettings),
    enabledChannels: channels,
  };
  await db
    .update(brands)
    .set({ settingsJson: settings, updatedAt: new Date() })
    .where(eq(brands.id, access.brandId));
  await db.insert(events).values({
    entityType: "brand",
    entityId: access.brandId,
    brandId: access.brandId,
    actor: "user",
    note: `analytics channels updated: ${channels.join(", ") || "none"}`,
  });
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

export async function addKeyword(input: {
  brandId: string;
  term: string;
}): Promise<ActionResult<{ id: string }>> {
  if (!idSchema.safeParse(input.brandId).success) {
    return { ok: false, error: "Invalid brand id" };
  }
  const term = input.term.trim();
  if (!term) return { ok: false, error: "Term is required" };
  if (term.length > 80) return { ok: false, error: "Term is too long" };
  const access = await tryBrand(input.brandId);
  if (!access) return { ok: false, error: "Brand not found" };
  const [row] = await db
    .insert(keywords)
    .values({ brandId: access.brandId, term, status: "active" })
    .returning({ id: keywords.id });
  if (!row) return { ok: false, error: "Insert failed" };
  await db.insert(events).values({
    entityType: "brand",
    entityId: access.brandId,
    brandId: access.brandId,
    actor: "user",
    note: `keyword added: ${term}`,
  });
  revalidatePath("/settings");
  return { ok: true, data: { id: row.id } };
}

export async function setKeywordStatus(input: {
  brandId: string;
  keywordId: string;
  status: "active" | "paused";
}): Promise<ActionResult<undefined>> {
  if (!idSchema.safeParse(input.keywordId).success) {
    return { ok: false, error: "Invalid keyword id" };
  }
  if (input.status !== "active" && input.status !== "paused") {
    return { ok: false, error: "Invalid status" };
  }
  const access = await ownedKeyword(input);
  if (!access) return { ok: false, error: "Keyword not found" };
  await db
    .update(keywords)
    .set({ status: input.status })
    .where(
      and(
        eq(keywords.id, input.keywordId),
        eq(keywords.brandId, access.brandId),
      ),
    );
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

export async function deleteKeyword(input: {
  brandId: string;
  keywordId: string;
}): Promise<ActionResult<undefined>> {
  if (!idSchema.safeParse(input.keywordId).success) {
    return { ok: false, error: "Invalid keyword id" };
  }
  const access = await ownedKeyword(input);
  if (!access) return { ok: false, error: "Keyword not found" };
  await db
    .delete(keywords)
    .where(
      and(
        eq(keywords.id, input.keywordId),
        eq(keywords.brandId, access.brandId),
      ),
    );
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

export async function pullKeywordNow(input: {
  brandId: string;
  keywordId: string;
}): Promise<ActionResult<{ jobId: string }>> {
  if (!idSchema.safeParse(input.keywordId).success) {
    return { ok: false, error: "Invalid keyword id" };
  }
  const access = await ownedKeyword(input);
  if (!access) return { ok: false, error: "Keyword not found" };
  const [row] = await db
    .insert(jobs)
    .values({
      kind: "research_pull",
      brandId: access.brandId,
      payloadJson: { source: "manual_keyword", keywordId: input.keywordId },
      status: "queued",
    })
    .returning({ id: jobs.id });
  if (!row) return { ok: false, error: "Failed to enqueue" };
  return { ok: true, data: { jobId: row.id } };
}
