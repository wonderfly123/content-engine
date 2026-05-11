import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { briefs, events } from "@/lib/db/schema";
import { assertBriefTransition } from "@/lib/pipelines/state";

export const runtime = "nodejs";

const idSchema = z.string().uuid();
const bodySchema = z.object({
  reason: z.string().min(1).max(500),
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
  const [row] = await db
    .select({ status: briefs.status })
    .from(briefs)
    .where(eq(briefs.id, id));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    assertBriefTransition(row.status, "rejected");
  } catch (err) {
    return NextResponse.json(
      { error: "illegal_transition", detail: (err as Error).message },
      { status: 422 },
    );
  }
  await db
    .update(briefs)
    .set({
      status: "rejected",
      rejectionReason: parsed.data.reason,
      reviewedAt: new Date(),
    })
    .where(eq(briefs.id, id));
  await db.insert(events).values({
    entityType: "brief",
    entityId: id,
    fromStatus: row.status,
    toStatus: "rejected",
    actor: "user",
    note: parsed.data.reason,
  });
  return NextResponse.json({ ok: true });
}
