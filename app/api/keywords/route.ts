/**
 * GET /api/keywords?brandId= — list keywords for a brand
 */

import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { keywords } from "@/lib/db/schema";

export const runtime = "nodejs";

const querySchema = z.object({ brandId: z.string().uuid() });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(q);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const rows = await db
    .select({
      id: keywords.id,
      term: keywords.term,
      status: keywords.status,
      lastPulledAt: keywords.lastPulledAt,
    })
    .from(keywords)
    .where(eq(keywords.brandId, parsed.data.brandId))
    .orderBy(desc(keywords.createdAt));
  return NextResponse.json({ keywords: rows });
}
