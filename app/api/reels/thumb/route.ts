import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { guard, requireLocalReels } from "@/lib/auth/workspace";
import { writeThumb } from "@/lib/reels/render";
import { resolveInCuts, resolveInJob } from "@/lib/reels/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One small frame of a clip's source file, for the blocks on the clip editor's timeline. Cached in the job's _cuts/.thumbs. */
export const GET = guard(async (req: NextRequest): Promise<Response> => {
  await requireLocalReels();
  const job = req.nextUrl.searchParams.get("job") ?? "";
  const file = req.nextUrl.searchParams.get("file") ?? "";
  const at = Number(req.nextUrl.searchParams.get("t") ?? "0");
  if (!/\.(mov|mp4|m4v)$/i.test(file) || !Number.isFinite(at) || at < 0) return new Response("bad request", { status: 400 });
  try {
    const source = resolveInJob(job, file);
    const stat = await fs.stat(source);
    const name = createHash("sha1").update(`${file}:${stat.mtimeMs}`).digest("hex").slice(0, 16);
    const out = resolveInCuts(job, `.thumbs/${name}-${Math.round(at * 10)}.jpg`);
    await writeThumb(source, at, out);
    return new Response(new Uint8Array(await fs.readFile(out)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
});
