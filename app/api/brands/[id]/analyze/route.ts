/**
 * /api/brands/[id]/analyze
 *   POST → Run Step 2 analysis (Firecrawl scrape + LLM persona extraction).
 *
 * Returns the drafted profile and persists it to `brands.settings_json.draft_profile`
 * so Step 3 can preload the LLM-drafted values and the user can compare
 * original-vs-edits.
 *
 * Synchronous for v1 (~20-40s budget); the route does not enqueue a job. If
 * latency proves problematic we'll move to a polling pattern with a `jobs` row.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { brands, events } from "@/lib/db/schema";
import { runAnalysis } from "@/lib/onboarding/analyze";

export const runtime = "nodejs";
export const maxDuration = 60;

const idSchema = z.string().uuid();

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idParse = idSchema.safeParse(id);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid brand id" }, { status: 400 });
  }
  const brandId = idParse.data;

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, brandId));
  if (!brand) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!brand.websiteUrl && !brand.description) {
    return NextResponse.json(
      { error: "Brand has no websiteUrl or description to analyze" },
      { status: 400 },
    );
  }

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
      .where(eq(brands.id, brandId));

    await db.insert(events).values({
      entityType: "brand",
      entityId: brandId,
      toStatus: "draft",
      actor: "system",
      note: "Onboarding step 2: analysis complete",
    });

    return NextResponse.json({ ok: true, drafted });
  } catch (err) {
    const detail = (err as Error).message;
    await db.insert(events).values({
      entityType: "brand",
      entityId: brandId,
      actor: "system",
      note: `Onboarding step 2: analysis failed — ${detail}`,
    });
    return NextResponse.json(
      { error: "Analysis failed", detail },
      { status: 500 },
    );
  }
}
