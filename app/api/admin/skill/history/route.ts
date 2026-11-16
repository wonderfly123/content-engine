import { NextResponse, type NextRequest } from "next/server";
import { AccessError, guard, requireUser } from "@/lib/auth/workspace";
import { isSkillPath, type SkillVersionView } from "@/lib/editor/skill-files";
import { namesFor } from "@/lib/editor/skill-people";
import { defaultSkillContent, skillHistory } from "@/lib/editor/skill-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One skill file's saved versions, newest first (GET ?path=hooks.md). Platform admin only. */
export const GET = guard(async (req: NextRequest): Promise<NextResponse> => {
  const me = await requireUser();
  if (me.role !== "admin") throw new AccessError(403, "Admins only.");
  const path = req.nextUrl.searchParams.get("path");
  if (!isSkillPath(path)) return NextResponse.json({ error: "That is not an editable skill file." }, { status: 400 });
  const rows = await skillHistory(path);
  const names = await namesFor(rows.map((r) => r.createdBy), me.userId);
  const fallback = defaultSkillContent(path);
  const versions: SkillVersionView[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    createdBy: names(r.createdBy),
    note: r.note,
    content: r.content,
    isDefault: r.content === fallback,
  }));
  return NextResponse.json({ versions });
});
