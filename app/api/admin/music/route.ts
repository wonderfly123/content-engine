/**
 * GET   /api/admin/music               the editor's built-in tracks, with short preview links
 * PATCH /api/admin/music { id, active }  turn a track on or off for the editor
 * Platform admin only (lib/music/library.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AccessError, guard, requireUser } from "@/lib/auth/workspace";
import { listTracks, setTrackActive } from "@/lib/music/library";
import { presignGet, r2Config } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new AccessError(403, "Admins only.");
  return user;
}

const storageOn = () => {
  try {
    r2Config();
    return true;
  } catch {
    return false;
  }
};

export const GET = guard(async (): Promise<NextResponse> => {
  await requireAdmin();
  const preview = storageOn();
  const tracks = (await listTracks()).map((t) => ({
    id: t.id,
    title: t.title,
    seconds: t.seconds,
    bpm: t.bpm,
    source: t.source,
    active: t.active,
    url: preview ? presignGet(t.r2Key, 3600) : null,
  }));
  return NextResponse.json({ tracks });
});

const patchSchema = z.object({ id: z.string().uuid(), active: z.boolean() });

export const PATCH = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireAdmin();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a track id and on or off." }, { status: 400 });
  if (!(await setTrackActive(parsed.data.id, parsed.data.active))) throw new AccessError(404, "Not found.");
  return NextResponse.json({ ok: true });
});
