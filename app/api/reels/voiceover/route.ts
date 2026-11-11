import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { readManifest, resolveInCuts, updateCut } from "@/lib/reels/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav" };
const MAX_BYTES = 50 * 1024 * 1024;

/** Saves a voice-over recorded in the browser into the job's vo/ folder and hands the cut to the editor. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  const job = String(form?.get("job") ?? "");
  const id = String(form?.get("id") ?? "");
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "no recording received" }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: "recording is too large" }, { status: 413 });
  const ext = EXT[audio.type.split(";")[0]];
  if (!ext) return NextResponse.json({ error: `unsupported recording type ${audio.type}` }, { status: 415 });

  try {
    const manifest = await readManifest(job);
    const cut = manifest?.cuts.find((c) => c.id === id);
    if (!cut) throw new Error("cut not found");
    if (cut.stage !== "voiceover") throw new Error("this cut is not waiting for a voice-over");

    const dir = resolveInCuts(job, "vo");
    await fs.mkdir(dir, { recursive: true });
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-");
    const existing = (await fs.readdir(dir)).filter((f) => f.startsWith(`${safeId}-take`)).length;
    const name = `${safeId}-take${existing + 1}.${ext}`;
    await fs.writeFile(path.join(dir, name), Buffer.from(await audio.arrayBuffer()));

    const updated = await updateCut(job, id, (c) => {
      c.voiceover = `vo/${name}`;
      c.stage = "editing";
      c.changesRequested = false;
    });
    return NextResponse.json({ cut: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
