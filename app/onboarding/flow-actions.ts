"use server";

/**
 * Server actions for the brand-voice onboarding flow (lib/onboarding/flow.ts).
 *
 * Each one validates its input with zod and checks the caller's access before touching anything:
 * `startOnboarding` creates in the caller's own workspace (tryWorkspace); the rest name a brand and
 * go through tryBrand, so another workspace's brand answers "Brand not found", like a missing one.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, like, ne } from "drizzle-orm";
import { tryBrand, tryWorkspace } from "@/lib/auth/workspace";
import { listCredentials } from "@/lib/credentials/store";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import type { Persona, Voice } from "@/lib/db/types";
import { FLOW_VERSION, flowStateOf, slugFromName } from "@/lib/onboarding/flow";
import { aboutSchema, reviewSchema, welcomeSchema, type AboutFormInput, type ReviewInput, type WelcomeInput } from "@/lib/onboarding/flow-schemas";
import { logBrandEvent, updateFlowState } from "@/lib/onboarding/flow-store";
import { supabaseEnv } from "@/lib/supabase/env";

export type FlowResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): FlowResult => ({ ok: false, error });
const firstIssue = (issues: { message: string }[]) => issues[0]?.message ?? "Check the form and try again.";

/** A slug for `name` that no other brand in the workspace has. */
async function freeSlug(workspaceId: string, name: string, exceptBrandId?: string): Promise<string> {
  const base = slugFromName(name);
  const taken = new Set(
    (
      await db
        .select({ slug: brands.slug })
        .from(brands)
        .where(and(eq(brands.workspaceId, workspaceId), like(brands.slug, `${base}%`), ...(exceptBrandId ? [ne(brands.id, exceptBrandId)] : [])))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

/** Saves the person's name where the account menu reads it (Supabase user_metadata.full_name). */
async function saveFullName(fullName: string): Promise<void> {
  if (!supabaseEnv()) return;
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    await supabase.auth.updateUser({ data: { full_name: fullName } });
  } catch (err) {
    console.error("could not save the user's name:", err);
  }
}

// ---- Step 1: Welcome ----------------------------------------------------------

export async function startOnboarding(input: WelcomeInput): Promise<FlowResult> {
  const parsed = welcomeSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const workspace = await tryWorkspace();
  if (!workspace) return fail("You are not a member of a workspace.");

  if (parsed.data.fullName) await saveFullName(parsed.data.fullName);

  const anthropic = (await listCredentials(workspace.workspaceId)).find((c) => c.provider === "anthropic");
  const keyWorks = Boolean(anthropic?.connected && anthropic.status === "ok");
  const next = keyWorks ? 3 : 2;

  const [row] = await db
    .insert(brands)
    .values({
      workspaceId: workspace.workspaceId,
      name: parsed.data.brandName,
      slug: await freeSlug(workspace.workspaceId, parsed.data.brandName),
      status: "draft",
      settingsJson: { onboarding: { flow: FLOW_VERSION, currentStep: next } },
    })
    .returning({ id: brands.id });
  if (!row) return fail("Could not create the brand.");
  await logBrandEvent(row.id, "Onboarding: brand created");

  revalidatePath("/onboarding");
  redirect(`/onboarding/${row.id}?step=${next}`);
}

// ---- Step 3: About ------------------------------------------------------------

export async function saveAbout(brandId: string, input: AboutFormInput): Promise<FlowResult> {
  const parsed = aboutSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const access = await tryBrand(brandId);
  if (!access) return fail("Brand not found");

  const { websiteUrl, instagramHandle, summary, captions } = parsed.data;
  // New answers mean a new research run.
  await updateFlowState(
    access.brandId,
    { currentStep: 4, about: { instagramHandle, summary, captions }, research: undefined, draft: undefined },
    { websiteUrl: websiteUrl ?? null, description: summary },
  );
  await logBrandEvent(access.brandId, "Onboarding: about the brand saved");
  redirect(`/onboarding/${access.brandId}?step=4`);
}

// ---- Step 5: Review -----------------------------------------------------------

export async function saveReview(brandId: string, input: ReviewInput): Promise<FlowResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const access = await tryBrand(brandId);
  if (!access) return fail("Brand not found");

  const [brand] = await db
    .select({ slug: brands.slug, name: brands.name, status: brands.status, personaJson: brands.personaJson, voiceJson: brands.voiceJson, settingsJson: brands.settingsJson })
    .from(brands)
    .where(eq(brands.id, access.brandId));
  if (!brand) return fail("Brand not found");

  const d = parsed.data;
  const persona: Persona = { ...brand.personaJson, mission: d.whatTheyDo, audienceSummary: d.whoItsFor };
  const voice: Voice = {
    ...brand.voiceJson,
    signaturePhrases: d.wordsTheyUse,
    bannedWords: d.wordsToAvoid,
    facts: d.facts.map((f) => ({ fact: f.fact, source: f.source || "added by you" })),
  };
  // A draft's slug follows its name until the brand goes live; after that, links keep working.
  const slug = brand.status === "draft" && d.name !== brand.name ? await freeSlug(access.workspaceId, d.name, access.brandId) : brand.slug;
  const settings = { ...(brand.settingsJson ?? {}), instagramHandle: d.instagramHandle ?? null } as Record<string, unknown>;
  settings.onboarding = { ...flowStateOf(brand.settingsJson), flow: FLOW_VERSION, currentStep: 6 };

  await db
    .update(brands)
    .set({
      name: d.name,
      slug,
      websiteUrl: d.websiteUrl ?? null,
      description: d.whatTheyDo,
      personaJson: persona,
      voiceJson: voice,
      voiceFreeform: d.tone,
      voiceExamples: d.exampleCaptions.map((caption) => ({ channel: "instagram", caption })),
      settingsJson: settings,
      updatedAt: new Date(),
    })
    .where(eq(brands.id, access.brandId));
  await logBrandEvent(access.brandId, `Onboarding: profile saved with ${d.facts.length} brand facts`);
  redirect(`/onboarding/${access.brandId}?step=6`);
}

// ---- Step 6 → 7: finish -------------------------------------------------------

export async function finishSetup(brandId: string): Promise<FlowResult> {
  const access = await tryBrand(brandId);
  if (!access) return fail("Brand not found");
  const [brand] = await db.select({ status: brands.status, description: brands.description }).from(brands).where(eq(brands.id, access.brandId));
  if (!brand) return fail("Brand not found");
  if (!brand.description.trim()) return fail("Finish the earlier steps first.");

  await updateFlowState(access.brandId, { currentStep: 7 }, { status: "active" });
  if (brand.status !== "active") await logBrandEvent(access.brandId, "Onboarding: brand is live");
  revalidatePath("/", "layout");
  redirect(`/onboarding/${access.brandId}?step=7`);
}
