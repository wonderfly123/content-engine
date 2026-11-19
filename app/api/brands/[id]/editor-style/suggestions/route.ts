/**
 * /api/brands/[id]/editor-style/suggestions
 *   POST { suggestionId, decision: "accept" | "dismiss" } -> Accept adds the tweak to its section as a new version.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireBrand } from "@/lib/auth/workspace";
import { decideSuggestion, SUGGESTION_GONE } from "@/lib/editor/style-learning";
import { StyleError } from "@/lib/editor/style-store";
import { editorStyleResponse } from "@/lib/editor/style-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ suggestionId: z.string(), decision: z.enum(["accept", "dismiss"]) });

export const POST = guard(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const brand = await requireBrand((await params).id);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    await decideSuggestion({
      workspaceId: brand.workspaceId,
      brandId: brand.brandId,
      brandName: brand.name,
      suggestionId: parsed.data.suggestionId,
      decision: parsed.data.decision,
      userId: brand.user.userId,
    });
  } catch (err) {
    if (err instanceof StyleError) return NextResponse.json({ error: err.message }, { status: err.message === SUGGESTION_GONE ? 404 : 409 });
    throw err;
  }
  return NextResponse.json(await editorStyleResponse(brand.brandId, brand.user));
});
