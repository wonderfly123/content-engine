import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const execFileP = promisify(execFile);

export interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  bit_rate?: string;
  channels?: number;
}

export interface FfprobeFormat {
  duration?: string;
  size?: string;
  bit_rate?: string;
  format_name?: string;
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

export interface ProbedMetadata {
  width?: number;
  height?: number;
  durationSec?: number;
  hasAudio: boolean;
  sizeBytes: number;
  format?: string;
  ratio?: number;
}

/**
 * Run ffprobe over a local file path. Returns raw structured output.
 * Allow overriding the ffprobe binary path for tests.
 */
export async function runFfprobe(
  filePath: string,
  ffprobePath: string = ffprobeInstaller.path,
): Promise<FfprobeResult> {
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];
  const { stdout } = await execFileP(ffprobePath, args, {
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout) as FfprobeResult;
}

/**
 * Download a remote URL into a temp file and probe it. Returns normalized
 * metadata. The caller is responsible for understanding that for very large
 * files this downloads the entire blob.
 */
export async function probeUrl(url: string): Promise<ProbedMetadata> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch blob: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = await mkdtemp(path.join(tmpdir(), "ce-asset-"));
  const filePath = path.join(dir, "blob");
  try {
    await writeFile(filePath, buf);
    const raw = await runFfprobe(filePath);
    return normalize(raw, buf.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function normalize(raw: FfprobeResult, sizeBytes: number): ProbedMetadata {
  const video = raw.streams.find((s) => s.codec_type === "video");
  const audio = raw.streams.find((s) => s.codec_type === "audio");
  const durationStr = raw.format?.duration ?? video?.duration;
  const duration = durationStr ? Number(durationStr) : undefined;
  const width = video?.width;
  const height = video?.height;
  const ratio = width && height ? width / height : undefined;
  return {
    width,
    height,
    durationSec: typeof duration === "number" && !Number.isNaN(duration)
      ? duration
      : undefined,
    hasAudio: Boolean(audio),
    sizeBytes,
    format: raw.format?.format_name,
    ratio,
  };
}
