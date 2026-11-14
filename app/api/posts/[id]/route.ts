/**
 * /api/posts/[id]
 *   GET    → fetch one post with its draft fields
 *   PATCH  → update scheduled_for (drag-drop reschedule on calendar)
 *   DELETE → cancel a queued post (NOT used for published posts)
 *
 * Only `status='queued'` posts may be PATCHed or DELETEd; the calendar UI
 * gates this client-side too but the server is the source of truth.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { drafts, posts } from "@/lib/db/schema";
import { recordEvent } from "@/lib/pipelines/events";
import { guard, requireOwned } from "@/lib/auth/workspace";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const patchSchema = z.object({
  scheduledFor: z.string().datetime(),
});

export const GET = guard(async (_req: NextRequest, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const access = await requireOwned(posts, id);
  const rows = await db
    .select({
      id: posts.id,
      draftId: posts.draftId,
      brandId: posts.brandId,
      channel: posts.channel,
      status: posts.status,
      scheduledFor: posts.scheduledFor,
      publishedAt: posts.publishedAt,
      externalUrl: posts.externalUrl,
      externalPostId: posts.externalPostId,
      publishError: posts.publishError,
      publishAttempts: posts.publishAttempts,
      format: drafts.format,
      caption: drafts.caption,
      metaJson: drafts.metaJson,
      briefId: drafts.briefId,
    })
    .from(posts)
    .innerJoin(drafts, eq(drafts.id, posts.draftId))
    .where(and(eq(posts.id, id), eq(posts.brandId, access.brandId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json(
      { data: null, error: { code: "not_found" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: { post: row }, error: null });
});

export const PATCH = guard(async (req: NextRequest, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
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

  const access = await requireOwned(posts, id);
  const mine = and(eq(posts.id, id), eq(posts.brandId, access.brandId));
  const existing = await db
    .select({ id: posts.id, status: posts.status })
    .from(posts)
    .where(mine)
    .limit(1);
  const row = existing[0];
  if (!row) {
    return NextResponse.json(
      { data: null, error: { code: "not_found" } },
      { status: 404 },
    );
  }
  if (row.status !== "queued") {
    return NextResponse.json(
      { data: null, error: { code: "not_queued", message: "Only queued posts can be rescheduled" } },
      { status: 409 },
    );
  }

  const [updated] = await db
    .update(posts)
    .set({ scheduledFor: target, updatedAt: new Date() })
    .where(mine)
    .returning();

  await recordEvent({
    entityType: "post",
    entityId: id,
    brandId: access.brandId,
    actor: "user",
    note: `Rescheduled to ${target.toISOString()}`,
  });

  return NextResponse.json({ data: { post: updated }, error: null });
});

export const DELETE = guard(async (_req: NextRequest, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const access = await requireOwned(posts, id);
  const mine = and(eq(posts.id, id), eq(posts.brandId, access.brandId));
  const existing = await db
    .select({ id: posts.id, status: posts.status })
    .from(posts)
    .where(mine)
    .limit(1);
  const row = existing[0];
  if (!row) {
    return NextResponse.json(
      { data: null, error: { code: "not_found" } },
      { status: 404 },
    );
  }
  if (row.status !== "queued") {
    return NextResponse.json(
      { data: null, error: { code: "not_queued" } },
      { status: 409 },
    );
  }
  await db.delete(posts).where(mine);
  await recordEvent({
    entityType: "post",
    entityId: id,
    brandId: access.brandId,
    fromStatus: "queued",
    toStatus: "cancelled",
    actor: "user",
  });
  return NextResponse.json({ data: { ok: true }, error: null });
});
