/** /api/brands/[id]/editor-style/history?section=opener: one section's saved versions, newest first. */
import { NextResponse, type NextRequest } from "next/server";
import { guard, requireBrand } from "@/lib/auth/workspace";
import { namesFor } from "@/lib/editor/skill-people";
import { defaultSection } from "@/lib/editor/style-defaults";
import { isStyleSection, parseSectionValue, sameValue } from "@/lib/editor/style-schema";
import { styleHistory } from "@/lib/editor/style-store";
import { SUGGESTION_AUTHOR, type StyleVersionView } from "@/lib/editor/style-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guard(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
  const brand = await requireBrand((await params).id);
  const section = req.nextUrl.searchParams.get("section");
  if (!isStyleSection(section)) return NextResponse.json({ error: "That is not a section of the editor style." }, { status: 400 });
  const rows = await styleHistory(brand.brandId, section);
  const names = await namesFor(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])), brand.user.userId);
  const fallback = defaultSection(section);
  const versions: StyleVersionView[] = rows.map((r) => {
    const parsed = parseSectionValue(section, r.value, fallback);
    const value = parsed.ok ? parsed.value : fallback;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy ? names(r.createdBy) : SUGGESTION_AUTHOR,
      note: r.note,
      value,
      isDefault: sameValue(value, fallback),
    };
  });
  return NextResponse.json({ versions });
});
