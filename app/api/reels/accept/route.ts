import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireLocalReels } from "@/lib/auth/workspace";
import { isValidKeep, keptSeconds } from "@/lib/reels/edits";
import { readManifest, resolveInCuts, updateCut } from "@/lib/reels/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav" };
const MAX_BYTES = 50 * 1024 * 1024;

const second = z.number().min(0).max(3600);
const keepSchema = z.array(z.object({ from: second, to: second })).min(1).max(50);
const fieldsSchema = z.object({
  job: z.string().min(1),
  id: z.string().min(1),
  /** "1" = a voice-over is attached, "0" = no voice-over. */
  voice: z.enum(["0", "1"]),
  /** Opening on-screen text; empty means none. */
  hook: z.string().max(120),
});

/**
 * Accepts a cut from the review-and-edit step in one go: the reviewer's light edits,
 * their voice-over (or the choice to have none), and the opening text.
 */
export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const form = await req.formData().catch(() => null);
  const text = (name: string) => { const v = form?.get(name); return typeof v === "string" ? v : ""; };
  const fields = fieldsSchema.safeParse({ job: text("job"), id: text("id"), voice: text("voice"), hook: text("hook").trim() });
  if (!fields.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id, hook } = fields.data;
  const voice = fields.data.voice === "1";

  // Edits are only sent when the reviewer changed something.
  let keep: z.infer<typeof keepSchema> | null = null;
  if (text("edits")) {
    let raw: unknown = null;
    try { raw = JSON.parse(text("edits")); } catch { /* rejected below */ }
    const parsed = keepSchema.safeParse(raw);
    if (!parsed.success || !isValidKeep(parsed.data)) return NextResponse.json({ error: "invalid edits" }, { status: 400 });
    keep = parsed.data;
  }

  const audio = form?.get("audio");
  let ext = "";
  if (voice) {
    if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "no recording received" }, { status: 400 });
    if (audio.size > MAX_BYTES) return NextResponse.json({ error: "recording is too large" }, { status: 413 });
    ext = EXT[audio.type.split(";")[0]] ?? "";
    if (!ext) return NextResponse.json({ error: `unsupported recording type ${audio.type}` }, { status: 415 });
  }

  try {
    const manifest = await readManifest(job);
    const cut = manifest?.cuts.find((c) => c.id === id);
    if (!cut) throw new Error("cut not found");
    // "voiceover" is the old separate recording stage; cuts left there are accepted the same way.
    if (cut.stage !== "cut_review" && cut.stage !== "voiceover") throw new Error("this cut is not waiting for review");

    let recording: string | null = null;
    if (voice && audio instanceof Blob) {
      const dir = resolveInCuts(job, "vo");
      await fs.mkdir(dir, { recursive: true });
      const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-");
      const existing = (await fs.readdir(dir)).filter((f) => f.startsWith(`${safeId}-take`)).length;
      const name = `${safeId}-take${existing + 1}.${ext}`;
      await fs.writeFile(path.join(dir, name), Buffer.from(await audio.arrayBuffer()));
      recording = `vo/${name}`;
    }

    const updated = await updateCut(job, id, (c) => {
      c.mode = voice ? "voice" : "music";
      if (recording) c.voiceover = recording; else delete c.voiceover;
      if (keep) c.edits = { keep, seconds: keptSeconds(keep) }; else delete c.edits;
      c.hook = hook;
      c.changesRequested = false;
      c.note = "";
      // Straight to final review only when the editor has nothing to do: no edits, no recording to mix and caption,
      // and the opening text already matches what is on a finished file.
      const editorWork = voice || Boolean(keep) || hook !== (c.hookBurned ?? "") || !c.final;
      c.stage = editorWork ? "editing" : "final_review";
    });
    return NextResponse.json({ cut: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
