import type { AssetKind } from "@/lib/db/enums";
import type { ProbedMetadata } from "./probe";
import type { ValidationError, ValidationResult, AssetMetadata } from "./types";

// Limits
export const MAX_REEL_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_REEL_DURATION_SEC = 90;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_LOOSE_BYTES = 50 * 1024 * 1024; // 50 MB (audio/graphic)

// Aspect ratio tolerance: ±2%
export const RATIO_TOLERANCE = 0.02;

// Meta ratios
export const REEL_RATIO = 9 / 16; // 0.5625
export const IMAGE_RATIOS: Array<{ name: string; ratio: number }> = [
  { name: "1:1", ratio: 1 },
  { name: "4:5", ratio: 4 / 5 },
  { name: "1.91:1", ratio: 1.91 / 1 },
];

const IMAGE_MIME_OK = new Set(["image/jpeg", "image/png"]);

function ratioMatches(actual: number, target: number, tol = RATIO_TOLERANCE): boolean {
  // tolerance is a fraction of the target ratio
  return Math.abs(actual - target) <= target * tol;
}

function err(
  code: string,
  expected: string,
  actual: string,
  message: string,
): ValidationError {
  return { code, expected, actual, message };
}

export type AssetPurpose =
  | "reel"
  | "carousel"
  | "image"
  | "audio"
  | "graphic"
  | "video";

export interface ValidateInput {
  kind: AssetKind;
  mimeType: string;
  probed: ProbedMetadata;
  /** purpose hint — when omitted we infer from kind */
  purpose?: AssetPurpose;
}

/**
 * Validate a probed asset against Meta-style content rules.
 * Returns ValidationResult — always a structured object; never throws on
 * domain rule failure (only on unexpected internal errors).
 */
export function validateAsset(input: ValidateInput): ValidationResult {
  const purpose: AssetPurpose = input.purpose ?? input.kind;

  const { probed, mimeType, kind } = input;
  const meta: AssetMetadata = {
    width: probed.width,
    height: probed.height,
    durationSec: probed.durationSec,
    sizeBytes: probed.sizeBytes,
    mimeType,
    hasAudio: probed.hasAudio,
    ratio: probed.ratio,
  };

  // --- Loose validation: audio / graphic ---
  if (kind === "audio" || kind === "graphic") {
    if (probed.sizeBytes > MAX_LOOSE_BYTES) {
      return {
        ok: false,
        error: err(
          "size_exceeded",
          `≤ ${MAX_LOOSE_BYTES} bytes`,
          `${probed.sizeBytes} bytes`,
          `${kind} file exceeds 50MB limit`,
        ),
        metadata: meta,
      };
    }
    return { ok: true, metadata: meta };
  }

  // --- Video / Reel ---
  if (kind === "video" || purpose === "reel") {
    if (probed.sizeBytes > MAX_REEL_BYTES) {
      return {
        ok: false,
        error: err(
          "size_exceeded",
          `≤ ${MAX_REEL_BYTES} bytes`,
          `${probed.sizeBytes} bytes`,
          "Reel exceeds 100MB limit",
        ),
        metadata: meta,
      };
    }
    if (probed.durationSec === undefined) {
      return {
        ok: false,
        error: err(
          "duration_missing",
          "video with duration metadata",
          "no duration",
          "Could not determine video duration",
        ),
        metadata: meta,
      };
    }
    if (probed.durationSec > MAX_REEL_DURATION_SEC) {
      return {
        ok: false,
        error: err(
          "duration_exceeded",
          `≤ ${MAX_REEL_DURATION_SEC}s`,
          `${probed.durationSec.toFixed(2)}s`,
          "Reel exceeds 90 second limit",
        ),
        metadata: meta,
      };
    }
    if (!probed.width || !probed.height) {
      return {
        ok: false,
        error: err(
          "dimensions_missing",
          "video with width/height",
          "missing dims",
          "Could not determine video dimensions",
        ),
        metadata: meta,
      };
    }
    if (!probed.ratio || !ratioMatches(probed.ratio, REEL_RATIO)) {
      return {
        ok: false,
        error: err(
          "ratio_invalid",
          `9:16 (${REEL_RATIO.toFixed(4)} ±2%)`,
          probed.ratio ? probed.ratio.toFixed(4) : "unknown",
          "Reel must be 9:16 vertical (±2%)",
        ),
        metadata: meta,
      };
    }
    if (!probed.hasAudio) {
      return {
        ok: false,
        error: err(
          "audio_missing",
          "at least one audio stream",
          "no audio stream",
          "Reel must have an audio track",
        ),
        metadata: meta,
      };
    }
    return { ok: true, metadata: meta };
  }

  // --- Image (carousel slot / single image) ---
  if (kind === "image") {
    if (!IMAGE_MIME_OK.has(mimeType)) {
      return {
        ok: false,
        error: err(
          "mime_invalid",
          "image/jpeg or image/png",
          mimeType,
          "Image must be JPEG or PNG",
        ),
        metadata: meta,
      };
    }
    if (probed.sizeBytes > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: err(
          "size_exceeded",
          `≤ ${MAX_IMAGE_BYTES} bytes`,
          `${probed.sizeBytes} bytes`,
          "Image exceeds 8MB limit",
        ),
        metadata: meta,
      };
    }
    if (!probed.width || !probed.height || !probed.ratio) {
      return {
        ok: false,
        error: err(
          "dimensions_missing",
          "image with width/height",
          "missing dims",
          "Could not determine image dimensions",
        ),
        metadata: meta,
      };
    }
    const matched = IMAGE_RATIOS.find((r) =>
      ratioMatches(probed.ratio!, r.ratio),
    );
    if (!matched) {
      return {
        ok: false,
        error: err(
          "ratio_invalid",
          IMAGE_RATIOS.map((r) => r.name).join(" / "),
          probed.ratio.toFixed(4),
          "Image must be 1:1, 4:5, or 1.91:1 (±2%)",
        ),
        metadata: meta,
      };
    }
    return { ok: true, metadata: meta };
  }

  // Fallthrough: unknown
  return {
    ok: false,
    error: err(
      "kind_unsupported",
      "video|image|audio|graphic",
      kind,
      `Unsupported asset kind: ${kind}`,
    ),
    metadata: meta,
  };
}
