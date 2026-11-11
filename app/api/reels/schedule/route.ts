import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { REEL_MODES, scheduleCut } from "@/lib/reels/schedule";
import { readManifest, resolveInCuts, updateCut } from "@/lib/reels/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  job: z.string().min(1),
  id: z.string().min(1),
  caption: z.string().min(1).max(2200),
  when: z.string().datetime(),
  mode: z.enum(REEL_MODES),
});

/** Final approval: hosts the finished file and queues it on the calendar. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id, caption, when, mode } = parsed.data;
  try {
    const manifest = await readManifest(job);
    const cut = manifest?.cuts.find((c) => c.id === id);
    if (!manifest || !cut) throw new Error("cut not found");
    if (cut.stage !== "final_review" || !cut.final) throw new Error("this cut is not ready for final approval");
    const done = await scheduleCut({
      brandSlug: manifest.brand,
      video: resolveInCuts(job, cut.final),
      caption,
      when: new Date(when),
      mode,
      title: `${job} · ${cut.title}`,
    });
    const updated = await updateCut(job, id, (c) => {
      c.stage = "scheduled";
      c.caption = caption.trim();
      c.scheduledFor = done.when.toISOString();
      c.postId = done.postId;
      c.trial = mode === "normal" ? null : mode === "trial-auto" ? "auto" : "manual";
    });
    return NextResponse.json({ cut: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
