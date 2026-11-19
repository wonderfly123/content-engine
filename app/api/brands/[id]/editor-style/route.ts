/**
 * /api/brands/[id]/editor-style: the brand's editor style (Settings > Editor style).
 *   GET  -> every section, pending suggestions
 *   POST -> { action: "save", section, value, note? } | { action: "restore", section, versionId } | { action: "reset", section }
 * Any member of the brand's workspace; nobody else (requireBrand answers 404).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireBrand } from "@/lib/auth/workspace";
import { resetStyleSection, restoreStyleVersion, saveStyleSection, StyleError } from "@/lib/editor/style-store";
import { editorStyleResponse } from "@/lib/editor/style-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guard(async (_req: NextRequest, { params }: Ctx): Promise<NextResponse> => {
  const brand = await requireBrand((await params).id);
  return NextResponse.json(await editorStyleResponse(brand.brandId, brand.user));
});

const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), section: z.string(), value: z.unknown(), note: z.string().optional() }),
  z.object({ action: z.literal("restore"), section: z.string(), versionId: z.string() }),
  z.object({ action: z.literal("reset"), section: z.string() }),
]);

export const POST = guard(async (req: NextRequest, { params }: Ctx): Promise<NextResponse> => {
  const brand = await requireBrand((await params).id);
  const parsed = changeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const c = parsed.data;
  const ref = { workspaceId: brand.workspaceId, brandId: brand.brandId, brandName: brand.name, userId: brand.user.userId };
  try {
    if (c.action === "save") await saveStyleSection({ ...ref, section: c.section, value: c.value, note: c.note });
    else if (c.action === "restore") await restoreStyleVersion({ ...ref, section: c.section, versionId: c.versionId });
    else await resetStyleSection({ ...ref, section: c.section });
  } catch (err) {
    if (err instanceof StyleError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  return NextResponse.json(await editorStyleResponse(brand.brandId, brand.user));
});
