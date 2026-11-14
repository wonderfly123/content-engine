import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { briefs, events, icps } from "@/lib/db/schema";
import { guard, requireOwned } from "@/lib/auth/workspace";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  hook: z.string().optional(),
  angle: z.string().optional(),
  keyMessage: z.string().optional(),
  suggestedHashtags: z.array(z.string()).optional(),
  suggestedCta: z.string().nullable().optional(),
  targetPublishDate: z.string().nullable().optional(),
  icpId: z.string().uuid().nullable().optional(),
  markEdited: z.boolean().optional(),
});

export const GET = guard(async (
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const access = await requireOwned(briefs, id);
  const mine = and(eq(briefs.id, id), eq(briefs.brandId, access.brandId));
  const [row] = await db.select().from(briefs).where(mine);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ brief: row });
});

export const PATCH = guard(async (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
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
  const access = await requireOwned(briefs, id);
  const mine = and(eq(briefs.id, id), eq(briefs.brandId, access.brandId));
  if (v.icpId) {
    const [icp] = await db
      .select({ id: icps.id })
      .from(icps)
      .where(and(eq(icps.id, v.icpId), eq(icps.brandId, access.brandId)));
    if (!icp) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const patch: Record<string, unknown> = {};
  if (v.title !== undefined) patch.title = v.title;
  if (v.hook !== undefined) patch.hook = v.hook;
  if (v.angle !== undefined) patch.angle = v.angle;
  if (v.keyMessage !== undefined) patch.keyMessage = v.keyMessage;
  if (v.suggestedHashtags !== undefined) patch.suggestedHashtags = v.suggestedHashtags;
  if (v.suggestedCta !== undefined) patch.suggestedCta = v.suggestedCta;
  if (v.targetPublishDate !== undefined) patch.targetPublishDate = v.targetPublishDate;
  if (v.icpId !== undefined) patch.icpId = v.icpId;
  if (v.markEdited) patch.status = "edited";
  await db.update(briefs).set(patch).where(mine);
  if (v.markEdited) {
    await db.insert(events).values({
      entityType: "brief",
      entityId: id,
      brandId: access.brandId,
      toStatus: "edited",
      actor: "user",
      note: "brief edited",
    });
  }
  const [row] = await db.select().from(briefs).where(mine);
  return NextResponse.json({ brief: row });
});

export const DELETE = guard(async (
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const access = await requireOwned(briefs, id);
  await db
    .delete(briefs)
    .where(and(eq(briefs.id, id), eq(briefs.brandId, access.brandId)));
  return NextResponse.json({ ok: true });
});
