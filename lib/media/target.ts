/**
 * How a clip is shrunk on arrival: the pure decision, from a summary of the source's ffprobe.
 *
 * Mirrored line for line in workers/optimize/target.py (the worker that actually runs ffmpeg).
 * Both are tested against the same table, workers/optimize/target_cases.json — change all three together.
 *
 *  - Output H.265 (libx265, CRF 20, preset medium) in MP4 tagged `hvc1`, `+faststart`, rotation baked in.
 *  - Never upscale. Portrait (after rotation): width <= 1080. Landscape / square: height <= 1920
 *    (so a 9:16 crop is still >= 1080x1920). Even dimensions.
 *  - Frame rate: kept up to 60, never raised (slow-motion footage is brought down to 60).
 *  - HDR (PQ / HLG / bt2020): tonemapped to SDR bt709.
 *  - Audio: copied when already AAC, else AAC 192k; none when the source has none.
 *  - "copy" (no re-encode, only a remux into MP4) when the source is already H.264/H.265, needs no
 *    downscale, is not HDR, is at most 60 fps and is under 12 Mbps: re-encoding would not help.
 */

export const MAX_PORTRAIT_WIDTH = 1080;
export const MAX_LANDSCAPE_HEIGHT = 1920;
export const MAX_FPS = 60;
export const COPY_MAX_BITRATE = 12_000_000;

export interface SourceSummary {
  /** Coded width and height, before rotation. */
  width: number;
  height: number;
  /** Display rotation in degrees (ffprobe's display matrix or `rotate` tag), e.g. -90, 90, 180. */
  rotation: number;
  fps: number | null;
  videoCodec: string;
  /** Bits per second, overall; null when unknown. */
  bitRate: number | null;
  audioCodec: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
}

export interface TargetPlan {
  action: "copy" | "encode";
  /** Output display dimensions. */
  width: number;
  height: number;
  /** Set only when the frame rate must come down. */
  maxFps: number | null;
  tonemap: boolean;
  audio: "copy" | "aac" | "none";
  /** MP4 tag for the video stream; "hvc1" for H.265 so Apple players accept it. */
  videoTag: "hvc1" | null;
}

const HDR_TRANSFERS = ["smpte2084", "arib-std-b67"];
const COPYABLE = ["h264", "hevc"];
const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const roundEven = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function isHdr(s: Pick<SourceSummary, "colorTransfer" | "colorPrimaries">): boolean {
  return HDR_TRANSFERS.includes((s.colorTransfer ?? "").toLowerCase()) || (s.colorPrimaries ?? "").toLowerCase() === "bt2020";
}

export function planTarget(s: SourceSummary): TargetPlan {
  const quarter = Math.abs(Math.round(s.rotation || 0)) % 180 === 90;
  const dw = quarter ? s.height : s.width;
  const dh = quarter ? s.width : s.height;
  const portrait = dh > dw;

  let width = dw;
  let height = dh;
  let downscale = false;
  if (portrait && dw > MAX_PORTRAIT_WIDTH) {
    width = MAX_PORTRAIT_WIDTH;
    height = roundEven((dh * MAX_PORTRAIT_WIDTH) / dw);
    downscale = true;
  } else if (!portrait && dh > MAX_LANDSCAPE_HEIGHT) {
    height = MAX_LANDSCAPE_HEIGHT;
    width = roundEven((dw * MAX_LANDSCAPE_HEIGHT) / dh);
    downscale = true;
  }

  const fps = s.fps && s.fps > 0 ? s.fps : null;
  const maxFps = fps !== null && fps > MAX_FPS + 0.5 ? MAX_FPS : null;
  const tonemap = isHdr(s);
  const codec = s.videoCodec.toLowerCase();
  const audioCodec = s.audioCodec?.toLowerCase() ?? null;
  const audio: TargetPlan["audio"] = audioCodec === null ? "none" : audioCodec === "aac" ? "copy" : "aac";

  const copy = COPYABLE.includes(codec) && !downscale && !tonemap && maxFps === null && s.bitRate !== null && s.bitRate > 0 && s.bitRate < COPY_MAX_BITRATE;
  if (copy) return { action: "copy", width: dw, height: dh, maxFps: null, tonemap: false, audio, videoTag: codec === "hevc" ? "hvc1" : null };
  return { action: "encode", width: even(width), height: even(height), maxFps, tonemap, audio, videoTag: "hvc1" };
}
