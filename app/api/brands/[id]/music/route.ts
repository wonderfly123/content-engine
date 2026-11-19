/**
 * /api/brands/[id]/music: the brand's music library for the editor (Settings > Music).
 *   GET   -> { tracks } every track in the brand's library, with short preview links
 *   PATCH { id, active }                                  turn one of the brand's tracks on or off
 *   POST  { action: "start", filename, size }             -> { key, url } (PUT the file there)
 *   POST  { action: "finish", key, title, seconds }       -> records the uploaded track
 * Any member of the brand's workspace; nobody else (requireBrand answers 404). Only ever touches
 * tracks of this brand, and uploads go under the brand's own folder (lib/music/library.ts).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AccessError, guard, requireBrand } from "@/lib/auth/workspace";
import { addBrandTrack, audioExtension, brandUploadKey, isBrandUploadKey, listBrandTracks, MAX_TRACK_BYTES, setBrandTrackActive } from "@/lib/music/library";
import { headObject, presignGet, presignPut, r2Config } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const storageOn = () => {
  try {
    r2Config();
    return true;
  } catch {
    return false;
  }
};

export const GET = guard(async (_req: NextRequest, { params }: Ctx): Promise<NextResponse> => {
  const brand = await requireBrand((await params).id);
  const preview = storageOn();
  const tracks = (await listBrandTracks(brand.brandId, brand.workspaceId)).map((t) => ({
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

export const PATCH = guard(async (req: NextRequest, { params }: Ctx): Promise<NextResponse> => {
  const brand = await requireBrand((await params).id);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a track id and on or off." }, { status: 400 });
  if (!(await setBrandTrackActive(brand.brandId, brand.workspaceId, parsed.data.id, parsed.data.active))) throw new AccessError(404, "Not found.");
  return NextResponse.json({ ok: true });
});

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), filename: z.string().trim().min(1).max(200), size: z.number().int().positive() }),
  z.object({ action: z.literal("finish"), key: z.string().max(400), title: z.string().trim().min(1).max(200), seconds: z.number().positive().max(3600) }),
]);

/** Uploading a track: "start" hands back a link to PUT the file to; "finish" checks it arrived and adds it. */
export const POST = guard(async (req: NextRequest, { params }: Ctx): Promise<NextResponse> => {
  const brand = await requireBrand((await params).id);
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  if (!storageOn()) return NextResponse.json({ error: "Storage isn't set up." }, { status: 503 });
  const body = parsed.data;
  if (body.action === "start") {
    if (!audioExtension(body.filename)) return NextResponse.json({ error: `${body.filename} isn't audio. Add .mp3, .m4a, .aac or .wav.` }, { status: 415 });
    if (body.size > MAX_TRACK_BYTES) return NextResponse.json({ error: `${body.filename} is over 50 MB.` }, { status: 413 });
    const key = brandUploadKey(brand.brandId, randomUUID(), body.filename);
    return NextResponse.json({ key, url: presignPut(key, 900) });
  }
  if (!isBrandUploadKey(brand.brandId, body.key)) return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  const head = await headObject(body.key);
  if (!head || head.size > MAX_TRACK_BYTES) return NextResponse.json({ error: "The file didn't arrive. Try again." }, { status: 422 });
  const track = await addBrandTrack({ brandId: brand.brandId, workspaceId: brand.workspaceId, key: body.key, title: body.title, seconds: body.seconds });
  return NextResponse.json({ id: track.id });
});
