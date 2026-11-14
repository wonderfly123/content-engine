/**
 * GET /api/drafts?brandId=&status=&channel=
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { drafts } from "@/lib/db/schema";
import { channelValues, draftStatusValues } from "@/lib/db/enums";
import { guard, listBrandIds, requireBrand } from "@/lib/auth/workspace";

export const runtime = "nodejs";

const querySchema = z.object({
  brandId: z.string().uuid().optional(),
  status: z.enum(draftStatusValues).optional(),
  channel: z.enum(channelValues).optional(),
});

export const GET = guard(async (req: NextRequest): Promise<NextResponse> => {
  const q = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(q);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const conds = [];
  if (parsed.data.brandId) {
    const access = await requireBrand(parsed.data.brandId);
    conds.push(eq(drafts.brandId, access.brandId));
  } else {
    const brandIds = await listBrandIds();
    if (brandIds.length === 0) return NextResponse.json({ drafts: [] });
    conds.push(inArray(drafts.brandId, brandIds));
  }
  if (parsed.data.status) conds.push(eq(drafts.status, parsed.data.status));
  if (parsed.data.channel) conds.push(eq(drafts.channel, parsed.data.channel));
  const rows = await db
    .select()
    .from(drafts)
    .where(and(...conds))
    .orderBy(desc(drafts.createdAt));
  return NextResponse.json({ drafts: rows });
});
