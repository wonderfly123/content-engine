import { promises as fs } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireBrandBySlug, requireLocalReels } from "@/lib/auth/workspace";
import { MAX_CLIP_NOTES, MAX_CLIP_NOTE_TEXT, pinClipNotes, type ClipNote } from "@/lib/reels/clip-notes";
import { parseEdl } from "@/lib/reels/clips";
import { deleteCut, listCuts, readManifest, resolveInCuts, updateCut } from "@/lib/reels/store";
import { MAX_SPOKEN_CHARS } from "@/lib/reels/voice-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const brand = req.nextUrl.searchParams.get("brand") ?? undefined;
  if (brand) await requireBrandBySlug(brand);
  return NextResponse.json({ cuts: await listCuts(brand) });
});

const patchSchema = z.object({
  job: z.string().min(1),
  id: z.string().min(1),
  action: z.enum(["request_changes", "save_caption", "save_voice_script"]),
  note: z.string().max(2000).optional(),
  // Notes on specific clips: the clip's position in the cut (from 1) and the section it covers, in seconds into the cut.
  clipNotes: z.array(z.object({ clip: z.number().int().min(1), from: z.number().min(0), to: z.number().min(0), text: z.string().min(1).max(MAX_CLIP_NOTE_TEXT) })).max(MAX_CLIP_NOTES).optional(),
  caption: z.string().max(2200).optional(),
  voiceScript: z.string().max(MAX_SPOKEN_CHARS).optional(),
});

export const PATCH = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id, action, note, caption, voiceScript, clipNotes } = parsed.data;
  try {
    // Clip notes are pinned to the cut's current clip list, so the editor gets the source file and timecodes of each.
    let pinned: ClipNote[] = [];
    if (action === "request_changes" && clipNotes?.length) {
      const edl = (await readManifest(job))?.cuts.find((c) => c.id === id)?.edl;
      if (!edl) throw new Error("this cut has no clip list to pin notes to");
      pinned = pinClipNotes(parseEdl(await fs.readFile(resolveInCuts(job, edl), "utf8")), clipNotes);
    }
    const cut = await updateCut(job, id, (c) => {
      if (action === "request_changes") {
        if (!note?.trim() && pinned.length === 0) throw new Error("say what should change");
        c.note = note?.trim() ?? "";
        if (pinned.length) c.clipNotes = pinned; else delete c.clipNotes;
        c.changesRequested = true;
        if (c.stage === "final_review") c.stage = "editing";
      } else if (action === "save_caption") {
        c.caption = (caption ?? "").trim();
      } else if (action === "save_voice_script") {
        if (c.stage !== "cut_review" && c.stage !== "voiceover") throw new Error("this cut is not waiting for review");
        c.voiceScript = voiceScript ?? "";
      }
    });
    return NextResponse.json({ cut });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});

const deleteSchema = z.object({ job: z.string().min(1), id: z.string().min(1) });

/** Deletes a cut from the first review. The cut moves to the manifest's `deleted` list; no file is removed. */
export const DELETE = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    await deleteCut(parsed.data.job, parsed.data.id, ["cut_review", "voiceover"]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
