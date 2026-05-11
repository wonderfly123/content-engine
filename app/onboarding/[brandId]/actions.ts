"use server";

/**
 * Onboarding server actions. One per step transition.
 *
 * Every action:
 *  - Validates input with Zod (rejects with typed error)
 *  - Filters DB writes by brandId from the URL parameter
 *  - Writes an `events` row to record the transition
 *  - Returns a discriminated-union result so client components can branch
 *    on error vs ok without throwing across the server/client boundary.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  brands,
  cadenceSettings,
  competitors,
  events,
  icps as icpsTable,
  inspirationAccounts,
  jobs,
} from "@/lib/db/schema";
import {
  CADENCE_PRESETS,
  cadenceSchema,
  competitorsInspirationSchema,
  createBrandSchema,
  icpsSchema,
  profileSchema,
  type CadenceInput,
  type CompetitorsInspirationInput,
  type CreateBrandInput,
  type IcpsInput,
  type ProfileInput,
} from "@/lib/onboarding/types";
import { runAnalysis } from "@/lib/onboarding/analyze";

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

// ---- Step 1: createBrand --------------------------------------------------

export async function createBrand(
  input: CreateBrandInput,
): Promise<ActionResult<{ brandId: string }>> {
  const parsed = createBrandSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", issues: flatten(parsed.error) };
  }

  const provisionalName = parsed.data.websiteUrl
    ? new URL(parsed.data.websiteUrl).hostname.replace(/^www\./, "")
    : "Untitled brand";
  const slug = `draft-${Date.now().toString(36)}`;

  const [row] = await db
    .insert(brands)
    .values({
      name: provisionalName,
      slug,
      status: "draft",
      websiteUrl: parsed.data.websiteUrl ?? null,
      description: parsed.data.description ?? "",
      settingsJson: { onboarding: { currentStep: 2 } },
    })
    .returning({ id: brands.id });

  if (!row) {
    return { ok: false, error: "Insert failed" };
  }

  await db.insert(events).values({
    entityType: "brand",
    entityId: row.id,
    toStatus: "draft",
    actor: "user",
    note: "Onboarding step 1: created draft brand",
  });

  revalidatePath("/onboarding");
  redirect(`/onboarding/${row.id}?step=2`);
}

// ---- Step 2: startAnalysis (server-action variant) -----------------------

export async function startAnalysis(
  brandId: string,
): Promise<ActionResult<undefined>> {
  const idParse = brandIdSchema.safeParse(brandId);
  if (!idParse.success) {
    return { ok: false, error: "Invalid brand id" };
  }

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, idParse.data));
  if (!brand) return { ok: false, error: "Brand not found" };

  try {
    const drafted = await runAnalysis({
      websiteUrl: brand.websiteUrl ?? undefined,
      description: brand.description || undefined,
    });

    const settings = { ...(brand.settingsJson ?? {}) } as Record<string, unknown>;
    settings.onboarding = {
      ...(typeof settings.onboarding === "object" && settings.onboarding
        ? (settings.onboarding as Record<string, unknown>)
        : {}),
      currentStep: 3,
      draftProfile: drafted,
      analyzedAt: new Date().toISOString(),
    };

    await db
      .update(brands)
      .set({ settingsJson: settings, updatedAt: new Date() })
      .where(eq(brands.id, idParse.data));

    await db.insert(events).values({
      entityType: "brand",
      entityId: idParse.data,
      actor: "system",
      note: "Onboarding step 2: analysis complete",
    });

    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
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

  // Slug must remain unique. Surface a friendly error instead of leaking the
  // raw constraint violation.
  const [clash] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.slug, parsed.data.slug));
  if (clash && clash.id !== idParse.data) {
    return {
      ok: false,
      error: `Slug "${parsed.data.slug}" is already taken`,
    };
  }

  const [brand] = await db
    .select({ settingsJson: brands.settingsJson })
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
    actor: "user",
    note: `Onboarding step 4: saved ${rows.length} ICPs`,
  });

  redirect(`/onboarding/${idParse.data}?step=5`);
}

// ---- Step 5: competitors + inspiration -----------------------------------

export async function saveCompetitorsInspiration(
  brandId: string,
  input: CompetitorsInspirationInput,
): Promise<ActionResult<undefined>> {
  const idParse = brandIdSchema.safeParse(brandId);
  if (!idParse.success) return { ok: false, error: "Invalid brand id" };
  const parsed = competitorsInspirationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", issues: flatten(parsed.error) };
  }

  // Replace-all strategy keeps the action simple for the wizard. Settings
  // tab does the same. Audit trail captures aggregate counts.
  await db.delete(competitors).where(eq(competitors.brandId, idParse.data));
  if (parsed.data.competitors.length > 0) {
    await db.insert(competitors).values(
      parsed.data.competitors.map((c) => ({
        brandId: idParse.data,
        handle: c.handle,
        platform: c.platform,
        url: c.url ?? null,
        notes: c.notes ?? null,
        pullWindowDays: c.pullWindowDays,
      })),
    );
  }

  await db
    .delete(inspirationAccounts)
    .where(eq(inspirationAccounts.brandId, idParse.data));
  if (parsed.data.inspiration.length > 0) {
    await db.insert(inspirationAccounts).values(
      parsed.data.inspiration.map((c) => ({
        brandId: idParse.data,
        handle: c.handle,
        platform: c.platform,
        url: c.url ?? null,
        notes: c.notes ?? null,
        pullWindowDays: c.pullWindowDays,
      })),
    );
  }

  await markStep(idParse.data, 6);
  await db.insert(events).values({
    entityType: "brand",
    entityId: idParse.data,
    actor: "user",
    note: `Onboarding step 5: ${parsed.data.competitors.length} competitors, ${parsed.data.inspiration.length} inspiration accounts`,
  });

  redirect(`/onboarding/${idParse.data}?step=6`);
}

// ---- Step 6: cadence ------------------------------------------------------

export async function saveCadence(
  brandId: string,
  input: CadenceInput,
): Promise<ActionResult<undefined>> {
  const idParse = brandIdSchema.safeParse(brandId);
  if (!idParse.success) return { ok: false, error: "Invalid brand id" };
  const parsed = cadenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", issues: flatten(parsed.error) };
  }

  const rows =
    parsed.data.preset === "custom"
      ? parsed.data.rows
      : CADENCE_PRESETS[parsed.data.preset];

  await db
    .delete(cadenceSettings)
    .where(eq(cadenceSettings.brandId, idParse.data));

  if (rows.length > 0) {
    await db.insert(cadenceSettings).values(
      rows.map((r) => ({
        brandId: idParse.data,
        channel: r.channel,
        format: r.format,
        perWeek: r.perWeek,
        enabled: r.enabled,
      })),
    );
  }

  await markStep(idParse.data, 7, { preset: parsed.data.preset });
  await db.insert(events).values({
    entityType: "brand",
    entityId: idParse.data,
    actor: "user",
    note: `Onboarding step 6: cadence preset=${parsed.data.preset}`,
  });

  redirect(`/onboarding/${idParse.data}?step=7`);
}

// ---- Step 8: markActive (+ optional research trigger) --------------------

export async function markActive(
  brandId: string,
  options: { triggerResearch?: boolean } = {},
): Promise<ActionResult<{ slug: string }>> {
  const idParse = brandIdSchema.safeParse(brandId);
  if (!idParse.success) return { ok: false, error: "Invalid brand id" };

  const [brand] = await db
    .select({ slug: brands.slug, status: brands.status })
    .from(brands)
    .where(eq(brands.id, idParse.data));
  if (!brand) return { ok: false, error: "Brand not found" };

  // Require at least one ICP for activation (Section 7: "name + 1 ICP").
  const [anyIcp] = await db
    .select({ id: icpsTable.id })
    .from(icpsTable)
    .where(eq(icpsTable.brandId, idParse.data))
    .limit(1);
  if (!anyIcp) {
    return {
      ok: false,
      error: "Cannot activate brand without at least one ICP",
    };
  }

  await db
    .update(brands)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(brands.id, idParse.data));

  await db.insert(events).values({
    entityType: "brand",
    entityId: idParse.data,
    fromStatus: brand.status,
    toStatus: "active",
    actor: "user",
    note: "Onboarding step 8: activated",
  });

  if (options.triggerResearch) {
    await db.insert(jobs).values({
      kind: "research_pull",
      brandId: idParse.data,
      payloadJson: { source: "onboarding_done" },
      status: "queued",
    });
    await db.insert(events).values({
      entityType: "brand",
      entityId: idParse.data,
      actor: "user",
      note: "Onboarding step 8: research_pull job enqueued",
    });
  }

  return { ok: true, data: { slug: brand.slug } };
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
  };
  await db
    .update(brands)
    .set({ settingsJson: settings, updatedAt: new Date() })
    .where(eq(brands.id, brandId));
}
