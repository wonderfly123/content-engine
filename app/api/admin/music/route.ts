/**
 * GET   /api/admin/music               the editor's built-in tracks, with short preview links
 * PATCH /api/admin/music { id, active }  turn a track on or off for the editor
 * POST  /api/admin/music { action: "start", filename, size }            -> { key, url } (PUT the file there)
 * POST  /api/admin/music { action: "finish", key, title, seconds }      -> records the uploaded track
 * Platform admin only (lib/music/library.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AccessError, guard, requireUser } from "@/lib/auth/workspace";
import { randomUUID } from "node:crypto";
import { addUploadedTrack, audioExtension, listTracks, MAX_TRACK_BYTES, MUSIC_PREFIX, setTrackActive, uploadKey } from "@/lib/music/library";
import { headObject, presignGet, presignPut, r2Config } from "@/lib/storage/r2";

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

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), filename: z.string().trim().min(1).max(200), size: z.number().int().positive() }),
  z.object({ action: z.literal("finish"), key: z.string().max(400), title: z.string().trim().min(1).max(200), seconds: z.number().positive().max(3600) }),
]);

/** Uploading a track: "start" hands back a link to PUT the file to; "finish" checks it arrived and adds it. */
export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireAdmin();
  if (!storageOn()) return NextResponse.json({ error: "Storage isn't set up." }, { status: 503 });
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  const body = parsed.data;
  if (body.action === "start") {
    if (!audioExtension(body.filename)) return NextResponse.json({ error: `${body.filename} isn't audio. Add .mp3, .m4a, .aac or .wav.` }, { status: 415 });
    if (body.size > MAX_TRACK_BYTES) return NextResponse.json({ error: `${body.filename} is over 50 MB.` }, { status: 413 });
    const key = uploadKey(randomUUID(), body.filename);
    return NextResponse.json({ key, url: presignPut(key, 900) });
  }
  if (!body.key.startsWith(`${MUSIC_PREFIX}uploads/`) || body.key.includes("..")) return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  const head = await headObject(body.key);
  if (!head || head.size > MAX_TRACK_BYTES) return NextResponse.json({ error: "The file didn't arrive. Try again." }, { status: 422 });
  const track = await addUploadedTrack({ key: body.key, title: body.title, seconds: body.seconds });
  return NextResponse.json({ id: track.id });
});
