/**
 * POST /api/posts/[id]/schedule
 *
 * Schedules a draft. Despite the path name, [id] here is the **draft id**
 * (we keep it under /posts/ so all calendar mutations live in one tree).
 *
 * Steps:
 *   1. Load draft; verify status === 'awaiting_final_review'.
 *   2. Insert posts row (status='queued') with the provided scheduled_for.
 *   3. Transition draft → 'scheduled' (terminal).
 *   4. Record `events` rows for both transitions.
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { drafts, posts } from "@/lib/db/schema";
import { assertDraftTransition } from "@/lib/pipelines/state";
import { recordEvent } from "@/lib/pipelines/events";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  scheduledFor: z.string().datetime(),
});

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: draftId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "invalid_body", issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const target = new Date(parsed.data.scheduledFor);
  if (target.getTime() <= Date.now()) {
    return NextResponse.json(
      { data: null, error: { code: "past_target" } },
      { status: 422 },
    );
  }

  const draftRows = await db
    .select({
      id: drafts.id,
      brandId: drafts.brandId,
      channel: drafts.channel,
      status: drafts.status,
    })
    .from(drafts)
    .where(eq(drafts.id, draftId))
    .limit(1);
  const draft = draftRows[0];
  if (!draft) {
    return NextResponse.json(
      { data: null, error: { code: "draft_not_found" } },
      { status: 404 },
    );
  }

  try {
    assertDraftTransition(draft.status, "scheduled");
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { code: "illegal_transition", message: (err as Error).message } },
      { status: 409 },
    );
  }

  try {
    const [postRow] = await db
      .insert(posts)
      .values({
        draftId: draft.id,
        brandId: draft.brandId,
        channel: draft.channel,
        status: "queued",
        scheduledFor: target,
      })
      .returning();

    if (!postRow) {
      return NextResponse.json(
        { data: null, error: { code: "insert_failed" } },
        { status: 500 },
      );
    }

    await db
      .update(drafts)
      .set({ status: "scheduled", reviewedAt: new Date() })
      .where(eq(drafts.id, draft.id));

    await recordEvent({
      entityType: "draft",
      entityId: draft.id,
      fromStatus: draft.status,
      toStatus: "scheduled",
      actor: "user",
      note: `Scheduled for ${target.toISOString()}`,
    });
    await recordEvent({
      entityType: "post",
      entityId: postRow.id,
      toStatus: "queued",
      actor: "user",
      note: "Created by schedule action",
    });

    return NextResponse.json({ data: { post: postRow }, error: null }, { status: 201 });
  } catch (err) {
    // Likely the unique-by-draft constraint if already scheduled.
    return NextResponse.json(
      { data: null, error: { code: "insert_failed", message: (err as Error).message } },
      { status: 500 },
    );
  }
}
