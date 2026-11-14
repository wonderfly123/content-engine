import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireBrandBySlug, requireLocalReels } from "@/lib/auth/workspace";
import { listCuts, updateCut } from "@/lib/reels/store";

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
  action: z.enum(["request_changes", "save_caption"]),
  note: z.string().max(2000).optional(),
  caption: z.string().max(2200).optional(),
});

export const PATCH = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id, action, note, caption } = parsed.data;
  try {
    const cut = await updateCut(job, id, (c) => {
      if (action === "request_changes") {
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
});
