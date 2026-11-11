import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { listCuts, updateCut } from "@/lib/reels/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const brand = req.nextUrl.searchParams.get("brand") ?? undefined;
  return NextResponse.json({ cuts: await listCuts(brand) });
}

const patchSchema = z.object({
  job: z.string().min(1),
  id: z.string().min(1),
  action: z.enum(["approve_cut", "request_changes", "save_caption"]),
  note: z.string().max(2000).optional(),
  caption: z.string().max(2200).optional(),
});

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id, action, note, caption } = parsed.data;
  try {
    const cut = await updateCut(job, id, (c) => {
      if (action === "approve_cut") {
        if (c.stage !== "cut_review") throw new Error("this cut is not waiting for cut review");
        // Voice-led cuts wait for a recording; music-led cuts go to the editor for the final file and post caption.
        c.stage = c.mode === "voice" ? "voiceover" : c.final ? "final_review" : "editing";
        c.changesRequested = false;
        c.note = "";
      } else if (action === "request_changes") {
        if (!note?.trim()) throw new Error("say what should change");
        c.note = note.trim();
        c.changesRequested = true;
        if (c.stage === "final_review") c.stage = "editing";
      } else if (action === "save_caption") {
        c.caption = (caption ?? "").trim();
      }
    });
    return NextResponse.json({ cut });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
