/**
 * Local ffmpeg work for the clip editor: source lengths, thumbnails, and re-rendering a preview
 * from a clip list. The render mirrors the video skill's render.sh so previews look the same.
 */
import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Clip } from "./clips";

const run = promisify(execFile);
const BIN_DIR = ["/opt/homebrew/bin", "/usr/local/bin"].find((d) => existsSync(path.join(d, "ffmpeg")));
const bin = (name: "ffmpeg" | "ffprobe") => (BIN_DIR ? path.join(BIN_DIR, name) : name);

/** Runs at most `limit` tasks at a time; ffmpeg on 4K footage is heavy. */
function limiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function <T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const heavy = limiter(4);

const durations = new Map<string, number>();

/** Length of a video file in seconds (cached per file and modification time). */
export async function sourceDuration(file: string): Promise<number> {
  const stat = await fs.stat(file);
  const key = `${file}:${stat.mtimeMs}`;
  const cached = durations.get(key);
  if (cached !== undefined) return cached;
  const { stdout } = await run(bin("ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`could not read the length of ${path.basename(file)}`);
  durations.set(key, seconds);
  return seconds;
}

/** Writes one small frame of `file` at `at` seconds to `out` (skipped when it already exists). */
export async function writeThumb(file: string, at: number, out: string): Promise<void> {
  if (existsSync(out)) return;
  await fs.mkdir(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp.jpg`;
  await heavy(() => run(bin("ffmpeg"), ["-v", "error", "-y", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=-2:120", "-q:v", "6", tmp]));
  await fs.rename(tmp, out);
}

/**
 * Renders `clips` (paths relative to `footageRoot`) into one 1080x1920 30fps silent video at `out`.
 * When `audioFrom` is a video with sound (a preview that already had music), its audio is carried over.
 */
export async function renderClips(footageRoot: string, clips: Clip[], out: string, audioFrom?: string): Promise<void> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "reel-render-"));
  const segments = await Promise.all(
    clips.map((c, i) =>
      heavy(async () => {
        const seg = path.join(work, `seg${String(i + 1).padStart(3, "0")}.mp4`);
        const geo = c.cropX === undefined
          ? "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
          : `crop=ih*9/16:ih:(iw-ih*9/16)*${c.cropX}:0,scale=1080:1920`;
        // An exact frame count per shot, so cut times never drift.
        const frames = Math.max(1, Math.round((c.dur / c.speed) * 30));
        const decode = Math.floor(c.speed) >= 30 ? ["-skip_frame", "nokey"] : ["-hwaccel", "videotoolbox"];
        await run(bin("ffmpeg"), [
          "-v", "error", "-y", ...decode, "-ss", String(c.in), "-t", (c.dur + 0.2 * c.speed + 0.2).toFixed(3), "-i", path.join(footageRoot, c.file),
          "-an", "-vf", `setpts=PTS/${c.speed},fps=30,${geo}`, "-frames:v", String(frames),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", seg,
        ], { maxBuffer: 16 * 1024 * 1024 });
        return seg;
      }),
    ),
  );
  const list = path.join(work, "list.txt");
  await fs.writeFile(list, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  await fs.mkdir(path.dirname(out), { recursive: true });
  const silent = path.join(work, "joined.mp4");
  await run(bin("ffmpeg"), ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);
  if (audioFrom && existsSync(audioFrom)) {
    await run(bin("ffmpeg"), ["-v", "error", "-y", "-i", silent, "-i", audioFrom, "-map", "0:v", "-map", "1:a?", "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart", out]);
  } else {
    await run(bin("ffmpeg"), ["-v", "error", "-y", "-i", silent, "-c", "copy", "-movflags", "+faststart", out]);
  }
}

export interface VideoFrame {
  /** Seconds into the video. */
  at: number;
  jpeg: Buffer;
}

/** Evenly spaced stills from `file` (about one every five seconds, 4 to 10 in all), small enough to send to Claude. */
export async function sampleFrames(file: string): Promise<VideoFrame[]> {
  const length = await sourceDuration(file);
  const count = Math.min(10, Math.max(4, Math.round(length / 5)));
  const times = Array.from({ length: count }, (_, i) => Math.round(((length * (i + 0.5)) / count) * 10) / 10);
  return Promise.all(
    times.map((at) =>
      heavy(async () => {
        const { stdout } = await run(
          bin("ffmpeg"),
          ["-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=-2:640", "-q:v", "5", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"],
          { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
        );
        if (!stdout.length) throw new Error(`could not read a frame of ${path.basename(file)}`);
        return { at, jpeg: stdout };
      }),
    ),
  );
}
