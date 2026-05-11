/**
 * POST /api/drafts/[id]/approve
 * Transitions a draft pending_review/edited → awaiting_assets (Section 6).
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { drafts, events } from "@/lib/db/schema";
import { assertDraftTransition } from "@/lib/pipelines/state";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const [row] = await db
    .select({ status: drafts.status })
    .from(drafts)
    .where(eq(drafts.id, id));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // approve = pending_review/edited → approved → awaiting_assets
  try {
    assertDraftTransition(row.status, "approved");
    assertDraftTransition("approved", "awaiting_assets");
  } catch (err) {
    return NextResponse.json(
      { error: "illegal_transition", detail: (err as Error).message },
      { status: 422 },
    );
  }
  await db
    .update(drafts)
    .set({ status: "awaiting_assets", reviewedAt: new Date() })
    .where(eq(drafts.id, id));
  await db.insert(events).values({
    entityType: "draft",
    entityId: id,
    fromStatus: row.status,
    toStatus: "approved",
    actor: "user",
    note: "draft approved",
  });
  await db.insert(events).values({
    entityType: "draft",
    entityId: id,
    fromStatus: "approved",
    toStatus: "awaiting_assets",
    actor: "system",
    note: "auto: ready for assets",
  });
  return NextResponse.json({ ok: true });
}
