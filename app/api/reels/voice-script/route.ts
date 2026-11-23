import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireBrandBySlug, requireLocalReels } from "@/lib/auth/workspace";
import { getCredentialForBrand } from "@/lib/credentials/store";
import { sampleFrames } from "@/lib/reels/render";
import { readManifest, resolveInCuts } from "@/lib/reels/store";
import { readScriptSources, writeVoiceScript } from "@/lib/reels/voice-script-writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ job: z.string().min(1), id: z.string().min(1) });

/**
 * Writes a ready-to-speak voice-over script for a cut in review, from the job's story notes, the reviewer's
 * earlier voice-overs, the editor's draft and stills from the cut. Returns the text only; nothing is saved.
 */
export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id } = parsed.data;

  let manifest: Awaited<ReturnType<typeof readManifest>> = null;
  try {
    manifest = await readManifest(job);
  } catch {
    /* an invalid job name reads as not found */
  }
  const cut = manifest?.cuts.find((c) => c.id === id);
  if (!manifest || !cut) return NextResponse.json({ error: "cut not found" }, { status: 400 });
  if (cut.stage !== "cut_review" && cut.stage !== "voiceover") return NextResponse.json({ error: "this cut is not waiting for review" }, { status: 400 });

  const brand = await requireBrandBySlug(manifest.brand);
  const key = await getCredentialForBrand(brand.brandId, "anthropic");
  if (!key) return NextResponse.json({ error: "Claude is not connected for this workspace (Settings > Integrations)." }, { status: 400 });

  try {
    // Stills are a help, not a requirement: a cut whose file cannot be read still gets a script from the text.
    const [sources, frames] = await Promise.all([readScriptSources(job), sampleFrames(resolveInCuts(job, cut.preview)).catch(() => [])]);
    const script = await writeVoiceScript(cut, { ...sources, frames }, key);
    return NextResponse.json({ script, frames: frames.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
});
