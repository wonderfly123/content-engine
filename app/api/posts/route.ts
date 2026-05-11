/**
 * /api/posts
 *   GET → list scheduled + published posts for a brand, with optional
 *         status / channel / date-range filters. Joins `drafts` for the
 *         caption + format so the calendar can render tiles in one round-trip.
 *
 * Read-only. Mutations live in `[id]/route.ts` and `[id]/schedule/route.ts`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { drafts, posts } from "@/lib/db/schema";
import { channelValues, postStatusValues } from "@/lib/db/enums";

export const runtime = "nodejs";

const querySchema = z.object({
  brandId: z.string().uuid(),
  status: z.array(z.enum(postStatusValues)).optional(),
  channels: z.array(z.enum(channelValues)).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    brandId: sp.get("brandId"),
    status: sp.getAll("status").length
      ? sp.getAll("status")
      : (sp.get("status") ?? "").split(",").filter(Boolean),
    channels: sp.getAll("channel").length
      ? sp.getAll("channel")
      : (sp.get("channel") ?? "").split(",").filter(Boolean),
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "invalid_query", issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { brandId, status, channels, from, to, limit } = parsed.data;

  const where = [eq(posts.brandId, brandId)];
  if (status && status.length) where.push(inArray(posts.status, status));
  if (channels && channels.length) where.push(inArray(posts.channel, channels));
  if (from) where.push(gte(posts.scheduledFor, new Date(from)));
  if (to) where.push(lte(posts.scheduledFor, new Date(to)));

  try {
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
        format: drafts.format,
        caption: drafts.caption,
        metaJson: drafts.metaJson,
      })
      .from(posts)
      .innerJoin(drafts, eq(drafts.id, posts.draftId))
      .where(and(...where))
      .orderBy(asc(posts.scheduledFor), desc(posts.createdAt))
      .limit(limit);

    return NextResponse.json({ data: { posts: rows }, error: null });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { code: "query_failed", message: (err as Error).message } },
      { status: 500 },
    );
  }
}
