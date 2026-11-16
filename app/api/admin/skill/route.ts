import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AccessError, guard, requireUser } from "@/lib/auth/workspace";
import type { SkillFileView } from "@/lib/editor/skill-files";
import { namesFor } from "@/lib/editor/skill-people";
import { SkillError, resetSkillFile, restoreSkillVersion, saveSkillVersion, skillOverview } from "@/lib/editor/skill-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdminUser() {
  const me = await requireUser();
  if (me.role !== "admin") throw new AccessError(403, "Admins only.");
  return me;
}

async function overview(youId: string): Promise<SkillFileView[]> {
  const first = await skillOverview();
  const names = await namesFor(first.flatMap((f) => (f.updatedBy ? [f.updatedBy] : [])), youId);
  return first.map((f) => ({ ...f, updatedBy: f.updatedBy ? names(f.updatedBy) : null }));
}

/** The editor skill's editable files with their current content. Platform admin only. */
export const GET = guard(async (): Promise<NextResponse> => {
  const me = await requireAdminUser();
  return NextResponse.json({ files: await overview(me.userId) });
});

const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), path: z.string(), content: z.string(), note: z.string().optional() }),
  z.object({ action: z.literal("restore"), path: z.string(), versionId: z.string() }),
  z.object({ action: z.literal("reset"), path: z.string() }),
]);

/** Saves a new version of one file: edited text, an earlier version, or the repo default. */
export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  const me = await requireAdminUser();
  const parsed = changeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const change = parsed.data;
  try {
    if (change.action === "save") await saveSkillVersion({ path: change.path, content: change.content, note: change.note, userId: me.userId });
    else if (change.action === "restore") await restoreSkillVersion({ path: change.path, versionId: change.versionId, userId: me.userId });
    else await resetSkillFile({ path: change.path, userId: me.userId });
  } catch (err) {
    if (err instanceof SkillError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  return NextResponse.json({ files: await overview(me.userId) });
});
