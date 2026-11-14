import { NextResponse, type NextRequest } from "next/server";
import { guard, requireBrand } from "@/lib/auth/workspace";
import { pullAnalyticsNow } from "@/lib/pipelines/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pulls fresh numbers from Instagram / Facebook for one brand's recent posts, on demand. */
export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  const body = (await req.json().catch(() => null)) as { brandId?: unknown } | null;
  const { brandId } = await requireBrand(body?.brandId);
  try {
    return NextResponse.json({ data: await pullAnalyticsNow({ brandId }), error: null });
  } catch (err) {
    return NextResponse.json({ data: null, error: { message: (err as Error).message } }, { status: 500 });
  }
});
