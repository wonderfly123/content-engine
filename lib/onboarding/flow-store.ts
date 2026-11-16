/**
 * Reads and writes the onboarding progress on `brands.settings_json.onboarding`, and runs the
 * research step. Callers check access to the brand first (tryBrand / requireBrand); nothing here does.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands, events } from "@/lib/db/schema";
import { getCredentialForBrand } from "@/lib/credentials/store";
import { researchCaller } from "@/lib/llm/research-caller";
import { FLOW_VERSION, flowStateOf, type FlowState } from "./flow";
import { recentInstagramCaptions } from "./instagram-captions";
import { draftProfile, type MessagesCaller, type ResearchInput } from "./research";

/** Merges `patch` into the brand's onboarding state (and marks it as this flow's). */
export async function updateFlowState(brandId: string, patch: Partial<FlowState>, columns: Partial<typeof brands.$inferInsert> = {}): Promise<void> {
  const [row] = await db.select({ settingsJson: brands.settingsJson }).from(brands).where(eq(brands.id, brandId));
  if (!row) return;
  const settings = { ...(row.settingsJson ?? {}) } as Record<string, unknown>;
  settings.onboarding = { ...flowStateOf(settings), ...patch, flow: FLOW_VERSION };
  await db
    .update(brands)
    .set({ ...columns, settingsJson: settings, updatedAt: new Date() })
    .where(eq(brands.id, brandId));
}

export async function logBrandEvent(brandId: string, note: string, actor: "user" | "system" = "user"): Promise<void> {
  await db.insert(events).values({ entityType: "brand", entityId: brandId, brandId, actor, note });
}

/** What the research step works from: what they typed on "About", plus captions. */
async function researchInput(brandId: string): Promise<ResearchInput | null> {
  const [brand] = await db
    .select({ name: brands.name, websiteUrl: brands.websiteUrl, description: brands.description, settingsJson: brands.settingsJson })
    .from(brands)
    .where(eq(brands.id, brandId));
  if (!brand) return null;
  const about = flowStateOf(brand.settingsJson).about;
  const fromInstagram = await recentInstagramCaptions(brandId);
  const pasted = about?.captions ?? [];
  const captions = fromInstagram.length ? fromInstagram : pasted;
  return {
    brandName: brand.name,
    websiteUrl: brand.websiteUrl ?? undefined,
    instagramHandle: about?.instagramHandle,
    summary: about?.summary || brand.description || brand.name,
    captions,
    captionsFrom: fromInstagram.length ? "instagram" : pasted.length ? "pasted" : "none",
  };
}

/**
 * The research step, run in the background after the route answers. Always ends with a draft saved
 * (from the web research, or from what they typed when that fails) and the step moved to "Review".
 */
export async function runResearchJob(brandId: string, makeCaller: (key: string) => MessagesCaller = researchCaller): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    const input = await researchInput(brandId);
    if (!input) return;
    const key = await getCredentialForBrand(brandId, "anthropic");
    const { error, ...draft } = await draftProfile(input, key ? makeCaller(key) : null);
    await updateFlowState(brandId, {
      currentStep: 5,
      draft,
      research: { status: "done", startedAt, finishedAt: new Date().toISOString(), ...(error ? { error: error.slice(0, 300) } : {}) },
    });
    await logBrandEvent(brandId, draft.fallback ? `Onboarding research fell back to the typed description: ${error ?? "unknown"}`.slice(0, 500) : "Onboarding research complete", "system");
  } catch (err) {
    await updateFlowState(brandId, {
      research: { status: "failed", startedAt, finishedAt: new Date().toISOString(), error: (err as Error).message.slice(0, 300) },
    }).catch(() => undefined);
  }
}
