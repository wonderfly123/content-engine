/**
 * /api/brands/[id]/storage: how long the brand's raw clips are kept after their video is finished
 * (Settings > Storage, lib/media/retention.ts).
 *   GET -> { retention, options }
 *   PUT -> { retention }
 * Any member of the brand's workspace; nobody else (requireBrand answers 404).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireBrand } from "@/lib/auth/workspace";
import { getBrandRetention, RETENTION_OPTIONS, setBrandRetention, type RetentionValue } from "@/lib/media/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const answer = async (brandId: string) =>
  NextResponse.json({ retention: await getBrandRetention(brandId), options: RETENTION_OPTIONS.map(({ value, label }) => ({ value, label })) });

export const GET = guard(async (_req: NextRequest, { params }: Ctx): Promise<NextResponse> => {
  const brand = await requireBrand((await params).id);
  return answer(brand.brandId);
});

const values = RETENTION_OPTIONS.map((o) => o.value) as [RetentionValue, ...RetentionValue[]];
const bodySchema = z.object({ retention: z.enum(values) });

export const PUT = guard(async (req: NextRequest, { params }: Ctx): Promise<NextResponse> => {
  const brand = await requireBrand((await params).id);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick one of the options." }, { status: 400 });
  await setBrandRetention(brand.brandId, parsed.data.retention, brand.user.userId);
  return answer(brand.brandId);
});
