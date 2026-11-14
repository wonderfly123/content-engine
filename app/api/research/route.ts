/**
 * GET  /api/research?brandId=  → latest research bundle for a brand
 * POST /api/research            → enqueue a research_pull job for brandId
 */

import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { researchBundles } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/pipelines/jobs";
import { guard, requireBrand } from "@/lib/auth/workspace";

export const runtime = "nodejs";

const querySchema = z.object({ brandId: z.string().uuid() });
const postSchema = z.object({ brandId: z.string().uuid() });

export const GET = guard(async (req: NextRequest): Promise<NextResponse> => {
  const q = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(q);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { brandId } = await requireBrand(parsed.data.brandId);
  const [bundle] = await db
    .select()
    .from(researchBundles)
    .where(eq(researchBundles.brandId, brandId))
    .orderBy(desc(researchBundles.pulledAt))
    .limit(1);
  return NextResponse.json({ bundle: bundle ?? null });
});

export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { brandId } = await requireBrand(parsed.data.brandId);
  const jobId = await enqueueJob({
    kind: "research_pull",
    brandId,
    payload: { source: "manual" },
  });
  return NextResponse.json({ ok: true, jobId }, { status: 202 });
});
