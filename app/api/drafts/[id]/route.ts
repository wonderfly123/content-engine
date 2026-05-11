import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { drafts, draftAssets, assets, events } from "@/lib/db/schema";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

const patchSchema = z.object({
  caption: z.string().optional(),
  body: z.string().nullable().optional(),
  imagePrompts: z.array(z.string()).optional(),
  markEdited: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Attached assets
  const links = await db
    .select({
      assetId: draftAssets.assetId,
      slotIndex: draftAssets.slotIndex,
      role: draftAssets.role,
      addedAt: draftAssets.addedAt,
      label: assets.label,
      kind: assets.kind,
      storageUrl: assets.storageUrl,
      thumbnailUrl: assets.thumbnailUrl,
    })
    .from(draftAssets)
    .innerJoin(assets, eq(draftAssets.assetId, assets.id))
    .where(eq(draftAssets.draftId, id));

  return NextResponse.json({ draft: row, assets: links });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const v = parsed.data;
  const patch: Record<string, unknown> = {};
  if (v.caption !== undefined) patch.caption = v.caption;
  if (v.body !== undefined) patch.body = v.body;
  if (v.imagePrompts !== undefined) patch.imagePrompts = v.imagePrompts;
  if (v.markEdited) patch.status = "edited";
  await db.update(drafts).set(patch).where(eq(drafts.id, id));
  if (v.markEdited) {
    await db.insert(events).values({
      entityType: "draft",
      entityId: id,
      toStatus: "edited",
      actor: "user",
      note: "draft edited",
    });
  }
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id));
  return NextResponse.json({ draft: row });
}
