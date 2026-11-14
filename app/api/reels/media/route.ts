import { createReadStream, promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { guard, requireLocalReels } from "@/lib/auth/workspace";
import { resolveInCuts, resolveInJob } from "@/lib/reels/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "audio/webm", ".m4a": "audio/mp4", ".wav": "audio/wav", ".jpg": "image/jpeg" };

/** Streams a local review file (with Range support so the player can seek). */
export const GET = guard(async (req: NextRequest): Promise<Response> => {
  await requireLocalReels();
  const job = req.nextUrl.searchParams.get("job") ?? "";
  const file = req.nextUrl.searchParams.get("file") ?? "";
  // footage=1 serves a clip's source file from the job folder (video only), for the clip editor.
  const footage = req.nextUrl.searchParams.get("footage") === "1";
  let full: string;
  try {
    full = footage ? resolveInJob(job, file) : resolveInCuts(job, file);
  } catch {
    return new Response("bad path", { status: 400 });
  }
  const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
  // Phone footage is .MOV; browsers are happier playing it when it is labelled as mp4.
  const type = footage ? (ext === ".mov" || ext === ".mp4" || ext === ".m4v" ? "video/mp4" : undefined) : TYPES[ext];
  const stat = await fs.stat(full).catch(() => null);
  if (!type || !stat?.isFile()) return new Response("not found", { status: 404 });

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let start = 0;
  let end = stat.size - 1;
  if (range) {
    if (range[1]) start = Number(range[1]);
    if (range[2]) end = Math.min(Number(range[2]), end);
    if (!range[1] && range[2]) { start = Math.max(stat.size - Number(range[2]), 0); end = stat.size - 1; }
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  }
  // Players abort range requests constantly while seeking; stop reading the file when they do
  // instead of pushing into a stream the browser has already closed.
  const disk = createReadStream(full, { start, end });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      disk.on("data", (chunk) => {
        try {
          controller.enqueue(chunk as Uint8Array);
        } catch {
          disk.destroy();
        }
      });
      disk.on("end", () => {
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      });
      disk.on("error", (err) => {
        try {
          controller.error(err);
        } catch {
          // already closed by the client
        }
      });
    },
    cancel() {
      disk.destroy();
    },
  });
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
    },
  });
});
