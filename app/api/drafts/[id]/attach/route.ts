/**
 * POST /api/drafts/[id]/attach
 *   Body: { assetId, slotIndex?, role? }
 *
 * Attaches an existing library asset to a draft. When all required slots
 * for the format are filled, transitions the draft from awaiting_assets
 * to awaiting_final_review.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { assets, drafts, draftAssets, events } from "@/lib/db/schema";
import { draftAssetRoleValues } from "@/lib/db/enums";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

const bodySchema = z.object({
  assetId: z.string().uuid(),
  slotIndex: z.number().int().min(0).max(20).default(0),
  role: z.enum(draftAssetRoleValues).default("primary"),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { assetId, slotIndex, role } = parsed.data;

  const [draft] = await db
    .select({
      id: drafts.id,
      brandId: drafts.brandId,
      format: drafts.format,
      status: drafts.status,
    })
    .from(drafts)
    .where(eq(drafts.id, id));
  if (!draft) {
    return NextResponse.json({ error: "draft_not_found" }, { status: 404 });
  }

  const [asset] = await db
    .select({ id: assets.id, brandId: assets.brandId })
    .from(assets)
    .where(eq(assets.id, assetId));
  if (!asset) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }
  if (asset.brandId !== draft.brandId) {
    return NextResponse.json(
      { error: "brand_mismatch", detail: "Asset belongs to a different brand" },
      { status: 422 },
    );
  }

  // Slot validation: same slot can't be filled twice (composite PK enforces it
  // but we want a nicer error).
  const existing = await db
    .select({
      slotIndex: draftAssets.slotIndex,
      role: draftAssets.role,
      assetId: draftAssets.assetId,
    })
    .from(draftAssets)
    .where(eq(draftAssets.draftId, id));
  const clash = existing.find(
    (r) => r.slotIndex === slotIndex && r.assetId !== assetId,
  );
  if (clash) {
    return NextResponse.json(
      { error: "slot_occupied", detail: `Slot ${slotIndex} already filled` },
      { status: 422 },
    );
  }
  const dupe = existing.find(
    (r) => r.slotIndex === slotIndex && r.assetId === assetId,
  );
  if (!dupe) {
    await db
      .insert(draftAssets)
      .values({ draftId: id, assetId, slotIndex, role });
  }

  // Re-fetch attachments and decide on transition.
  const attached = dupe
    ? existing
    : [...existing, { slotIndex, role, assetId }];
  const fullyAttached = isFullyAttached(draft.format, attached);

  let transitioned = false;
  if (fullyAttached && draft.status === "awaiting_assets") {
    await db
      .update(drafts)
      .set({ status: "awaiting_final_review" })
      .where(
        and(eq(drafts.id, id), eq(drafts.status, "awaiting_assets")),
      );
    await db.insert(events).values({
      entityType: "draft",
      entityId: id,
      fromStatus: "awaiting_assets",
      toStatus: "awaiting_final_review",
      actor: "system",
      note: `all slots filled (${attached.length})`,
    });
    transitioned = true;
  }

  return NextResponse.json(
    { ok: true, transitioned, attachedCount: attached.length },
    { status: 201 },
  );
}

function isFullyAttached(
  format: string,
  rows: Array<{ slotIndex: number; role: string }>,
): boolean {
  if (format === "reel" || format === "image") {
    return rows.some((r) => r.role === "primary");
  }
  if (format === "carousel") {
    return rows.length >= 2;
  }
  return false;
}
