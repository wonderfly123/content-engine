/**
 * GET /api/comments/[postId]
 *
 * Polls Meta Graph for the latest comments on a published post. Until the
 * Publisher adapter implements `fetchComments` (deferred — Task 4 stub),
 * this endpoint returns an empty list so the UI can render gracefully.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { guard, requireOwned } from "@/lib/auth/workspace";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ postId: string }>;
}

export interface CommentRow {
  id: string;
  username: string;
  text: string;
  at: string;
}

export const GET = guard(async (_req: NextRequest, ctx: RouteContext) => {
  const { postId } = await ctx.params;
  const access = await requireOwned(posts, postId);

  // Confirm the post exists + is published before pretending to fetch.
  const [row] = await db
    .select({ id: posts.id, status: posts.status })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.brandId, access.brandId)))
    .limit(1);
  if (!row) {
    return NextResponse.json(
      { data: null, error: { code: "not_found" } },
      { status: 404 },
    );
  }

  // TODO: when Publisher.fetchComments lands, call it here.
  const comments: CommentRow[] = [];
  return NextResponse.json({ data: { comments }, error: null });
});
