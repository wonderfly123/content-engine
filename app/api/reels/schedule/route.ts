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
  coverAt: z.number().min(0).max(3600),
  /** Opening on-screen text the reviewer picked or wrote; empty or missing means none. */
  hook: z.string().max(120).optional(),
});

/** Final approval: hosts the finished file and queues it on the calendar. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id, caption, when, mode, coverAt } = parsed.data;
  const hook = (parsed.data.hook ?? "").trim();
  try {
    const manifest = await readManifest(job);
    const cut = manifest?.cuts.find((c) => c.id === id);
    if (!manifest || !cut) throw new Error("cut not found");
    if (cut.stage !== "final_review" || !cut.final) throw new Error("this cut is not ready for final approval");
    if (hook !== (cut.hookBurned ?? "")) {
      // The approved text is not on the video yet. Keep the approval; the editor changes the text and schedules with these details.
      if (new Date(when).getTime() < Date.now() + 60_000) throw new Error("the scheduled time is in the past");
      const pending = await updateCut(job, id, (c) => {
        c.hook = hook;
        c.caption = caption.trim();
        c.approval = { when, mode, coverAt };
        c.coverAt = coverAt;
        c.note = `Approved for ${new Date(when).toLocaleString()}. ${hook ? `Add opening text: "${hook}"` : "Remove the opening text"}, then schedule it.`;
        c.changesRequested = true;
        c.stage = "editing";
      });
      return NextResponse.json({ cut: pending, pendingText: true });
    }
    const done = await scheduleCut({
      brandSlug: manifest.brand,
      video: resolveInCuts(job, cut.final),
      caption,
      when: new Date(when),
      mode,
      coverAt,
      title: `${job} · ${cut.title}`,
    });
    const updated = await updateCut(job, id, (c) => {
      c.stage = "scheduled";
      c.caption = caption.trim();
      c.scheduledFor = done.when.toISOString();
      c.postId = done.postId;
      c.coverAt = coverAt;
      c.trial = mode === "normal" ? null : mode === "trial-auto" ? "auto" : "manual";
    });
    return NextResponse.json({ cut: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
