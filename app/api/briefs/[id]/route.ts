import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { briefs, events } from "@/lib/db/schema";

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

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const [row] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ brief: row });
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
  if (v.title !== undefined) patch.title = v.title;
  if (v.hook !== undefined) patch.hook = v.hook;
  if (v.angle !== undefined) patch.angle = v.angle;
  if (v.keyMessage !== undefined) patch.keyMessage = v.keyMessage;
  if (v.suggestedHashtags !== undefined) patch.suggestedHashtags = v.suggestedHashtags;
  if (v.suggestedCta !== undefined) patch.suggestedCta = v.suggestedCta;
  if (v.targetPublishDate !== undefined) patch.targetPublishDate = v.targetPublishDate;
  if (v.icpId !== undefined) patch.icpId = v.icpId;
  if (v.markEdited) patch.status = "edited";
  await db.update(briefs).set(patch).where(eq(briefs.id, id));
  if (v.markEdited) {
    await db.insert(events).values({
      entityType: "brief",
      entityId: id,
      toStatus: "edited",
      actor: "user",
      note: "brief edited",
    });
  }
  const [row] = await db.select().from(briefs).where(eq(briefs.id, id));
  return NextResponse.json({ brief: row });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  await db.delete(briefs).where(eq(briefs.id, id));
  return NextResponse.json({ ok: true });
}
