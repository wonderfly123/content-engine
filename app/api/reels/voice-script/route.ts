import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guard, requireBrandBySlug, requireLocalReels } from "@/lib/auth/workspace";
import { getCredentialForBrand } from "@/lib/credentials/store";
import { sampleFrames } from "@/lib/reels/render";
import { readManifest, resolveInCuts, updateCut } from "@/lib/reels/store";
import { readScriptSources, writeVoiceScript } from "@/lib/reels/voice-script-writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ job: z.string().min(1), id: z.string().min(1), force: z.boolean().optional() });

/** Scripts being written right now, so a cut asked for twice at once is still written once. */
const writing = new Map<string, Promise<string>>();

/**
 * Writes a ready-to-speak voice-over script for a cut in review, from the job's story notes, the reviewer's
 * earlier voice-overs, the editor's draft and stills from the cut, and saves it with the cut. A cut that
 * already has one gets that one back; only `force` (Regenerate script) writes it again.
 */
export const POST = guard(async (req: NextRequest): Promise<NextResponse> => {
  await requireLocalReels();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { job, id, force } = parsed.data;

  let manifest: Awaited<ReturnType<typeof readManifest>> = null;
  try {
    manifest = await readManifest(job);
  } catch {
    /* an invalid job name reads as not found */
  }
  const cut = manifest?.cuts.find((c) => c.id === id);
  if (!manifest || !cut) return NextResponse.json({ error: "cut not found" }, { status: 400 });
  if (cut.stage !== "cut_review" && cut.stage !== "voiceover") return NextResponse.json({ error: "this cut is not waiting for review" }, { status: 400 });

  if (cut.voiceScript?.trim() && !force) return NextResponse.json({ script: cut.voiceScript, saved: true });

  const brand = await requireBrandBySlug(manifest.brand);
  const key = await getCredentialForBrand(brand.brandId, "anthropic");
  if (!key) return NextResponse.json({ error: "Claude is not connected for this workspace (Settings > Integrations)." }, { status: 400 });

  try {
    // Stills are a help, not a requirement: a cut whose file cannot be read still gets a script from the text.
    const slot = `${job}/${id}`;
    let pending = force ? undefined : writing.get(slot);
    if (!pending) {
      pending = (async () => {
        const [sources, frames] = await Promise.all([readScriptSources(job), sampleFrames(resolveInCuts(job, cut.preview)).catch(() => [])]);
        const script = await writeVoiceScript(cut, { ...sources, frames }, key);
        await updateCut(job, id, (c) => { c.voiceScript = script; });
        return script;
      })();
      writing.set(slot, pending);
      void pending.catch(() => undefined).finally(() => { if (writing.get(slot) === pending) writing.delete(slot); });
    }
    return NextResponse.json({ script: await pending });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
});
