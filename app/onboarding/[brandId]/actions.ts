"use server";

/**
 * Brand profile and ICP actions, used by Settings (persona and ICPs tabs).
 * The onboarding flow itself has its own actions in app/onboarding/flow-actions.ts.
 *
 * Every action:
 *  - Validates input with Zod (rejects with typed error)
 *  - Checks the caller owns the brand (`tryBrand`) before any read or write;
 *    someone else's brand answers "Brand not found", like a missing one
 *  - Filters DB writes by the checked brand id
 *  - Writes an `events` row to record the transition
 *  - Returns a discriminated-union result so client components can branch
 *    on error vs ok without throwing across the server/client boundary.
 */

import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { tryBrand } from "@/lib/auth/workspace";
import { db } from "@/lib/db";
import {
  brands,
  events,
  icps as icpsTable,
} from "@/lib/db/schema";
import {
  ONBOARDING_STEPS_VERSION,
  icpsSchema,
  profileSchema,
  type IcpsInput,
  type ProfileInput,
} from "@/lib/onboarding/types";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      issues?: z.typeToFlattenedError<unknown>;
    };

const brandIdSchema = z.string().uuid("Invalid brand id");

function flatten(err: z.ZodError): z.typeToFlattenedError<unknown> {
  return err.flatten() as z.typeToFlattenedError<unknown>;
}

// ---- Step 3: saveProfile --------------------------------------------------

export async function saveProfile(
  brandId: string,
  input: ProfileInput,
): Promise<ActionResult<undefined>> {
  const idParse = brandIdSchema.safeParse(brandId);
  if (!idParse.success) return { ok: false, error: "Invalid brand id" };
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", issues: flatten(parsed.error) };
  }

  const access = await tryBrand(idParse.data);
  if (!access) return { ok: false, error: "Brand not found" };

  // Slug must remain unique inside the workspace. Surface a friendly error
  // instead of leaking the raw constraint violation. Other workspaces' slugs
  // are not looked at, so this never reveals what someone else has taken.
  const [clash] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(
      and(
        eq(brands.slug, parsed.data.slug),
        eq(brands.workspaceId, access.workspaceId),
        ne(brands.id, access.brandId),
      ),
    )
    .limit(1);
  if (clash) {
    return {
      ok: false,
      error: `Slug "${parsed.data.slug}" is already taken`,
    };
  }

  const [brand] = await db
    .select({ settingsJson: brands.settingsJson, voiceJson: brands.voiceJson })
    .from(brands)
    .where(eq(brands.id, idParse.data));
  if (!brand) return { ok: false, error: "Brand not found" };

  const settings = { ...(brand.settingsJson ?? {}) } as Record<string, unknown>;
  settings.onboarding = {
    ...(typeof settings.onboarding === "object" && settings.onboarding
      ? (settings.onboarding as Record<string, unknown>)
      : {}),
    currentStep: 4,
  };

  await db
    .update(brands)
    .set({
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.tagline ?? "",
      personaJson: {
        mission: parsed.data.tagline ?? "",
        audienceSummary: parsed.data.audienceSummary ?? "",
        archetype: parsed.data.archetype,
        pointOfView: parsed.data.pointOfView ?? "",
        traits: parsed.data.traits ?? [],
      },
      voiceJson: {
        // Brand facts are edited in onboarding's review step; this form leaves them as they are.
        ...(brand.voiceJson?.facts ? { facts: brand.voiceJson.facts } : {}),
        toneSliders: parsed.data.toneSliders,
        emojiPolicy:
          parsed.data.emojiPolicy === "liberal"
            ? "frequent"
            : parsed.data.emojiPolicy === "none"
              ? "none"
              : "sparse",
        hashtagStyle:
          parsed.data.hashtagStyle === "none"
            ? "none"
            : parsed.data.hashtagStyle === "many-broad"
              ? "heavy"
              : "moderate",
        readingLevel: parsed.data.readingLevel,
        bannedWords: parsed.data.bannedWords,
        signaturePhrases: parsed.data.signaturePhrases,
      },
      voiceFreeform: parsed.data.voiceFreeform ?? "",
      voiceExamples: parsed.data.voiceExamples.map((e) => ({
        caption: e.caption,
        notes: e.url,
      })),
      settingsJson: settings,
      updatedAt: new Date(),
    })
    .where(eq(brands.id, idParse.data));

  await db.insert(events).values({
    entityType: "brand",
    entityId: idParse.data,
    brandId: idParse.data,
    actor: "user",
    note: "Onboarding step 3: profile saved",
  });

  redirect(`/onboarding/${idParse.data}?step=4`);
}

// ---- Step 4: saveICPs -----------------------------------------------------

export async function saveICPs(
  brandId: string,
  input: IcpsInput,
): Promise<ActionResult<undefined>> {
  const idParse = brandIdSchema.safeParse(brandId);
  if (!idParse.success) return { ok: false, error: "Invalid brand id" };
  const parsed = icpsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", issues: flatten(parsed.error) };
  }

  const access = await tryBrand(idParse.data);
  if (!access) return { ok: false, error: "Brand not found" };

  // Enforce single default; if none flagged, mark the first.
  const rows = parsed.data.icps.map((icp, i, arr) => ({
    ...icp,
    isDefault:
      arr.some((x) => x.isDefault)
        ? icp.isDefault && arr.findIndex((x) => x.isDefault) === i
        : i === 0,
  }));

  const existing = await db
    .select({ id: icpsTable.id })
    .from(icpsTable)
    .where(eq(icpsTable.brandId, idParse.data));
  const existingIds = new Set(existing.map((r) => r.id));
  const submittedIds = new Set(rows.filter((r) => r.id).map((r) => r.id!));

  const toDelete = [...existingIds].filter((id) => !submittedIds.has(id));
  if (toDelete.length > 0) {
    await db
      .delete(icpsTable)
      .where(
        and(
          eq(icpsTable.brandId, idParse.data),
          inArray(icpsTable.id, toDelete),
        ),
      );
  }

  for (const row of rows) {
    if (row.id && existingIds.has(row.id)) {
      await db
        .update(icpsTable)
        .set({
          name: row.name,
          description: row.description,
          painPoints: row.painPoints,
          whereTheyHangOut: row.whereTheyHangOut,
          contentTheyEngageWith: row.contentTheyEngageWith,
          isDefault: row.isDefault,
          updatedAt: new Date(),
        })
        .where(
          and(eq(icpsTable.id, row.id), eq(icpsTable.brandId, idParse.data)),
        );
    } else {
      await db.insert(icpsTable).values({
        brandId: idParse.data,
        name: row.name,
        description: row.description,
        painPoints: row.painPoints,
        whereTheyHangOut: row.whereTheyHangOut,
        contentTheyEngageWith: row.contentTheyEngageWith,
        isDefault: row.isDefault,
      });
    }
  }

  await markStep(idParse.data, 5);
  await db.insert(events).values({
    entityType: "brand",
    entityId: idParse.data,
    brandId: idParse.data,
    actor: "user",
    note: `Onboarding step 4: saved ${rows.length} ICPs`,
  });

  redirect(`/onboarding/${idParse.data}?step=5`);
}

// ---- helpers --------------------------------------------------------------

async function markStep(
  brandId: string,
  step: number,
  extras: Record<string, unknown> = {},
): Promise<void> {
  const [row] = await db
    .select({ settingsJson: brands.settingsJson })
    .from(brands)
    .where(eq(brands.id, brandId));
  if (!row) return;
  const settings = { ...(row.settingsJson ?? {}) } as Record<string, unknown>;
  settings.onboarding = {
    ...(typeof settings.onboarding === "object" && settings.onboarding
      ? (settings.onboarding as Record<string, unknown>)
      : {}),
    ...extras,
    currentStep: step,
    stepsVersion: ONBOARDING_STEPS_VERSION,
  };
  await db
    .update(brands)
    .set({ settingsJson: settings, updatedAt: new Date() })
    .where(eq(brands.id, brandId));
}
