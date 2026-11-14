import { promises as fs } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireLocalReels } from "@/lib/auth/workspace";
import { clipsProblem, formatEdl, parseEdl, totalSeconds, type Clip } from "@/lib/reels/clips";
import { renderClips, sourceDuration } from "@/lib/reels/render";
import { jobDir, readManifest, resolveInCuts, resolveInJob, updateCut } from "@/lib/reels/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const VIDEO = /\.(mov|mp4|m4v)$/i;

/** Length of each source file named by the clips; files that are missing or not video are left out. */
async function sourceLengths(job: string, clips: Clip[]): Promise<Map<string, number>> {
  const lengths = new Map<string, number>();
  await Promise.all([...new Set(clips.map((c) => c.file))].map(async (file) => {
    if (!VIDEO.test(file)) return;
    try {
      lengths.set(file, await sourceDuration(resolveInJob(job, file)));
    } catch {
      // unknown footage: reported by clipsProblem
    }
  }));
  return lengths;
}

/** The cut's clips, each with the length of its source file so the editor knows how far an edge can be dragged. */
export const GET = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const job = req.nextUrl.searchParams.get("job") ?? "";
  const id = req.nextUrl.searchParams.get("id") ?? "";
  try {
    const cut = (await readManifest(job))?.cuts.find((c) => c.id === id);
    if (!cut) throw new Error("cut not found");
    if (!cut.edl) throw new Error("this cut has no clip list");
    const clips = parseEdl(await fs.readFile(resolveInCuts(job, cut.edl), "utf8"));
    const lengths = await sourceLengths(job, clips);
    const missing = clips.find((c) => !lengths.has(c.file));
    if (missing) throw new Error(`footage not found: ${missing.file}`);
    return NextResponse.json({ clips: clips.map((c) => ({ ...c, max: lengths.get(c.file) })) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});

const clipSchema = z.object({
  file: z.string().min(1).max(300),
  in: z.number().min(0),
  dur: z.number().positive(),
  speed: z.number().positive(),
  cropX: z.number().min(0).max(1).optional(),
});
const bodySchema = z.union([
  z.object({ job: z.string().min(1), id: z.string().min(1), clips: z.array(clipSchema).min(1).max(200) }),
  z.object({ job: z.string().min(1), id: z.string().min(1), revert: z.literal(true) }),
]);

/**
 * Saves the reviewer's clip edit: writes a new clip list, re-renders the preview from it, and points the cut at both.
 * The editor's own version is kept in `original`; `revert` goes back to it.
 */
export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id } = parsed.data;
  try {
    const cut = (await readManifest(job))?.cuts.find((c) => c.id === id);
    if (!cut) throw new Error("cut not found");
    if (cut.stage !== "cut_review" && cut.stage !== "voiceover") throw new Error("this cut is not waiting for review");

    if ("revert" in parsed.data) {
      const original = cut.original;
      if (!original) throw new Error("this cut has not been edited");
      const reverted = await updateCut(job, id, (c) => { c.edl = original.edl; c.preview = original.preview; delete c.original; });
      return NextResponse.json({ cut: reverted });
    }

    if (!cut.edl) throw new Error("this cut has no clip list");
    const clips: Clip[] = parsed.data.clips;
    const lengths = await sourceLengths(job, clips);
    const problem = clipsProblem(clips, (file) => lengths.get(file));
    if (problem) throw new Error(problem);

    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-");
    const dir = resolveInCuts(job, "previews/app");
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(resolveInCuts(job, "edl/app"), { recursive: true });
    const n = (await fs.readdir(dir)).filter((f) => f.startsWith(`${safeId}-edit`) && f.endsWith(".mp4")).length + 1;
    const edl = `edl/app/${safeId}-edit${n}.tsv`;
    const preview = `previews/app/${safeId}-edit${n}.mp4`;
    await fs.writeFile(resolveInCuts(job, edl), formatEdl(clips));
    await renderClips(jobDir(job), clips, resolveInCuts(job, preview), resolveInCuts(job, cut.preview));

    const updated = await updateCut(job, id, (c) => {
      c.original ??= { edl: cut.edl!, preview: cut.preview };
      c.edl = edl;
      c.preview = preview;
      // Any trim was made against the old preview.
      delete c.edits;
    });
    return NextResponse.json({ cut: updated, seconds: totalSeconds(clips) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
