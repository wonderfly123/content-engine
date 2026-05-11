import { describe, it, expect } from "vitest";
import {
  validateAsset,
  REEL_RATIO,
  MAX_REEL_BYTES,
  MAX_REEL_DURATION_SEC,
  MAX_IMAGE_BYTES,
} from "../validate";
import type { ProbedMetadata } from "../probe";

function reelProbe(over: Partial<ProbedMetadata> = {}): ProbedMetadata {
  return {
    width: 1080,
    height: 1920,
    durationSec: 30,
    hasAudio: true,
    sizeBytes: 5_000_000,
    ratio: 1080 / 1920,
    ...over,
  };
}

function imageProbe(over: Partial<ProbedMetadata> = {}): ProbedMetadata {
  return {
    width: 1080,
    height: 1080,
    hasAudio: false,
    sizeBytes: 500_000,
    ratio: 1,
    ...over,
  };
}

describe("validateAsset - Reels", () => {
  it("accepts exact 9:16 with audio at 30s/5MB", () => {
    const v = validateAsset({
      kind: "video",
      mimeType: "video/mp4",
      probed: reelProbe(),
    });
    expect(v.ok).toBe(true);
  });

  it("rejects ratio off by 3% (0.5625 * 1.03)", () => {
    const badRatio = REEL_RATIO * 1.03;
    const v = validateAsset({
      kind: "video",
      mimeType: "video/mp4",
      probed: reelProbe({ width: 1080, height: Math.round(1080 / badRatio), ratio: badRatio }),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("ratio_invalid");
  });

  it("accepts ratio within ±2% tolerance", () => {
    const okRatio = REEL_RATIO * 1.018;
    const v = validateAsset({
      kind: "video",
      mimeType: "video/mp4",
      probed: reelProbe({ ratio: okRatio }),
    });
    expect(v.ok).toBe(true);
  });

  it("rejects no-audio reel", () => {
    const v = validateAsset({
      kind: "video",
      mimeType: "video/mp4",
      probed: reelProbe({ hasAudio: false }),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("audio_missing");
  });

  it("rejects duration > 90s", () => {
    const v = validateAsset({
      kind: "video",
      mimeType: "video/mp4",
      probed: reelProbe({ durationSec: MAX_REEL_DURATION_SEC + 0.5 }),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("duration_exceeded");
  });

  it("rejects size > 100MB", () => {
    const v = validateAsset({
      kind: "video",
      mimeType: "video/mp4",
      probed: reelProbe({ sizeBytes: MAX_REEL_BYTES + 1 }),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("size_exceeded");
  });

  it("rejects missing duration", () => {
    const v = validateAsset({
      kind: "video",
      mimeType: "video/mp4",
      probed: reelProbe({ durationSec: undefined }),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("duration_missing");
  });
});

describe("validateAsset - Images", () => {
  it("accepts 1080x1080 JPEG", () => {
    const v = validateAsset({
      kind: "image",
      mimeType: "image/jpeg",
      probed: imageProbe(),
    });
    expect(v.ok).toBe(true);
  });

  it("accepts 1080x1350 (4:5) PNG", () => {
    const v = validateAsset({
      kind: "image",
      mimeType: "image/png",
      probed: imageProbe({ width: 1080, height: 1350, ratio: 1080 / 1350 }),
    });
    expect(v.ok).toBe(true);
  });

  it("accepts 1080x566 (1.91:1)", () => {
    const v = validateAsset({
      kind: "image",
      mimeType: "image/jpeg",
      probed: imageProbe({ width: 1080, height: 566, ratio: 1080 / 566 }),
    });
    expect(v.ok).toBe(true);
  });

  it("rejects 2:1 unsupported ratio", () => {
    const v = validateAsset({
      kind: "image",
      mimeType: "image/jpeg",
      probed: imageProbe({ width: 1080, height: 540, ratio: 2 }),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("ratio_invalid");
  });

  it("rejects gif mime", () => {
    const v = validateAsset({
      kind: "image",
      mimeType: "image/gif",
      probed: imageProbe(),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("mime_invalid");
  });

  it("rejects size > 8MB", () => {
    const v = validateAsset({
      kind: "image",
      mimeType: "image/jpeg",
      probed: imageProbe({ sizeBytes: MAX_IMAGE_BYTES + 1 }),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("size_exceeded");
  });
});

describe("validateAsset - loose kinds", () => {
  it("accepts a 40MB audio file", () => {
    const v = validateAsset({
      kind: "audio",
      mimeType: "audio/mpeg",
      probed: {
        sizeBytes: 40 * 1024 * 1024,
        hasAudio: true,
      },
    });
    expect(v.ok).toBe(true);
  });

  it("rejects a 60MB graphic file", () => {
    const v = validateAsset({
      kind: "graphic",
      mimeType: "image/svg+xml",
      probed: { sizeBytes: 60 * 1024 * 1024, hasAudio: false },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("size_exceeded");
  });
});
