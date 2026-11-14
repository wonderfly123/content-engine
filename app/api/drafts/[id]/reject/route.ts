import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { drafts, events } from "@/lib/db/schema";
import { assertDraftTransition } from "@/lib/pipelines/state";
import { guard, requireOwned } from "@/lib/auth/workspace";

export const runtime = "nodejs";

const idSchema = z.string().uuid();
const bodySchema = z.object({
  reason: z.string().min(1).max(500),
});

export const POST = guard(async (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
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
  const access = await requireOwned(drafts, id);
  const mine = and(eq(drafts.id, id), eq(drafts.brandId, access.brandId));
  const [row] = await db
    .select({ status: drafts.status })
    .from(drafts)
    .where(mine);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    assertDraftTransition(row.status, "rejected");
  } catch (err) {
    return NextResponse.json(
      { error: "illegal_transition", detail: (err as Error).message },
      { status: 422 },
    );
  }
  await db
    .update(drafts)
    .set({
      status: "rejected",
      rejectionReason: parsed.data.reason,
      reviewedAt: new Date(),
    })
    .where(mine);
  await db.insert(events).values({
    entityType: "draft",
    entityId: id,
    brandId: access.brandId,
    fromStatus: row.status,
    toStatus: "rejected",
    actor: "user",
    note: parsed.data.reason,
  });
  return NextResponse.json({ ok: true });
});
