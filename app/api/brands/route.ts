/**
 * /api/brands
 *   GET  → list brands (id, name, slug, status) — drives sidebar switcher
 *          and onboarding entry "Continue setup" list.
 *   POST → create a draft brand from { websiteUrl?, description? }.
 *
 * Brand isolation: this endpoint operates across all brands (single-user app).
 * Per-brand reads MUST go through /api/brands/[id].
 */

import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands, events } from "@/lib/db/schema";
import { createBrandSchema } from "@/lib/onboarding/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await db
      .select({
        id: brands.id,
        name: brands.name,
        slug: brands.slug,
        status: brands.status,
        createdAt: brands.createdAt,
        updatedAt: brands.updatedAt,
      })
      .from(brands)
      .orderBy(desc(brands.updatedAt));
    return NextResponse.json({ brands: rows });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list brands", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  // Draft brand: name/slug provisional until Step 3.
  const provisionalName =
    parsed.data.websiteUrl
      ? new URL(parsed.data.websiteUrl).hostname.replace(/^www\./, "")
      : "Untitled brand";
  // Provisional slug must be unique; suffix with timestamp to avoid clashes
  // with existing rows. User edits this in Step 3.
  const slug = `draft-${Date.now().toString(36)}`;

  try {
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
      .returning({ id: brands.id, slug: brands.slug });

    if (!row) {
      return NextResponse.json(
        { error: "Failed to create brand" },
        { status: 500 },
      );
    }

    await db.insert(events).values({
      entityType: "brand",
      entityId: row.id,
      toStatus: "draft",
      actor: "user",
      note: "Onboarding step 1: created draft brand",
    });

    return NextResponse.json({ id: row.id, slug: row.slug }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "Insert failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
