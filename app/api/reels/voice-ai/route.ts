import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireLocalReels } from "@/lib/auth/workspace";
import { generateVoiceover } from "@/lib/reels/ai-voice";
import { readManifest } from "@/lib/reels/store";
import { MAX_SPOKEN_CHARS, spokenTextProblem } from "@/lib/reels/voice-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

const bodySchema = z.object({
  job: z.string().min(1),
  id: z.string().min(1),
  /** What the voice should say, as the reviewer left it. */
  text: z.string().max(MAX_SPOKEN_CHARS * 2),
});

/**
 * Speaks a cut's voice-over script with the AI voice and returns the audio (WAV).
 * Nothing is saved here: the reviewer listens, then the take is sent on accept exactly like a recorded one.
 */
export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id } = parsed.data;
  const text = parsed.data.text.trim();
  const problem = spokenTextProblem(text);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const cut = (await readManifest(job))?.cuts.find((c) => c.id === id);
    if (!cut) throw new Error("cut not found");
    if (cut.stage !== "cut_review" && cut.stage !== "voiceover") throw new Error("this cut is not waiting for review");
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const wav = await generateVoiceover(text);
    return new NextResponse(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
});
