"use server";

/**
 * Settings-tab server actions: which channels show in analytics.
 *
 * Other brand tabs reuse the existing actions in app/onboarding/[brandId]/actions.ts
 * (saveProfile, saveICPs, saveCadence).
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tryBrand } from "@/lib/auth/workspace";
import { db } from "@/lib/db";
import { brands, events } from "@/lib/db/schema";
import { channelValues } from "@/lib/db/enums";
import type { BrandSettings } from "@/lib/db/types";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const idSchema = z.string().uuid();

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
