/**
 * GET /api/comments/[postId]
 *
 * Polls Meta Graph for the latest comments on a published post. Until the
 * Publisher adapter implements `fetchComments` (deferred — Task 4 stub),
 * this endpoint returns an empty list so the UI can render gracefully.
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";

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

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { postId } = await ctx.params;

  // Confirm the post exists + is published before pretending to fetch.
  const [row] = await db
    .select({ id: posts.id, status: posts.status })
    .from(posts)
    .where(eq(posts.id, postId))
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
}
