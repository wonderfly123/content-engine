/**
 * GET /api/alerts
 *   ?brandId=<uuid>  — alerts for one brand (default for sidebar badge)
 *   ?scope=all       — alerts across all of the caller's brands (cross-brand Home view)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { listSystemAlerts } from "@/lib/alerts/system-alerts";
import { guard, listBrandIds, requireBrand } from "@/lib/auth/workspace";

export const runtime = "nodejs";

const querySchema = z.object({
  brandId: z.string().uuid().optional(),
  scope: z.enum(["all", "brand"]).optional(),
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
  const { brandId, scope } = parsed.data;
  // One brand: it must be the caller's. No brand named: only the caller's brands.
  const brandIds = scope !== "all" && brandId ? [(await requireBrand(brandId)).brandId] : await listBrandIds();
  try {
    const alerts = await listSystemAlerts({ brandIds });
    return NextResponse.json({ alerts });
  } catch (err) {
    return NextResponse.json(
      { error: "failed_to_list_alerts", detail: (err as Error).message },
      { status: 500 },
    );
  }
});
