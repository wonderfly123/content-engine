import { describe, it, expect } from "vitest";
import { normalize, type FfprobeResult } from "../probe";

describe("probe.normalize", () => {
  it("extracts dimensions, duration, audio flag, and ratio for a Reel-like input", () => {
    const raw: FfprobeResult = {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1920,
          duration: "12.34",
        },
        { codec_type: "audio", codec_name: "aac", channels: 2 },
      ],
      format: {
        duration: "12.34",
        size: "1048576",
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      },
    };
    const out = normalize(raw, 1_048_576);
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    expect(out.durationSec).toBeCloseTo(12.34, 2);
    expect(out.hasAudio).toBe(true);
    expect(out.sizeBytes).toBe(1_048_576);
    expect(out.ratio).toBeCloseTo(1080 / 1920, 4);
  });

  it("flags hasAudio=false when only a video stream is present", () => {
    const raw: FfprobeResult = {
      streams: [{ codec_type: "video", width: 800, height: 600 }],
      format: { duration: "5" },
    };
    const out = normalize(raw, 1234);
    expect(out.hasAudio).toBe(false);
    expect(out.ratio).toBeCloseTo(800 / 600, 4);
  });

  it("handles still images (no duration, no audio)", () => {
    const raw: FfprobeResult = {
      streams: [
        { codec_type: "video", codec_name: "mjpeg", width: 1080, height: 1080 },
      ],
      format: { format_name: "image2" },
    };
    const out = normalize(raw, 500_000);
    expect(out.durationSec).toBeUndefined();
    expect(out.hasAudio).toBe(false);
    expect(out.ratio).toBe(1);
  });

  it("returns undefined durationSec when ffprobe gives NaN", () => {
    const raw: FfprobeResult = {
      streams: [{ codec_type: "video", width: 100, height: 100 }],
      format: { duration: "N/A" },
    };
    const out = normalize(raw, 1);
    expect(out.durationSec).toBeUndefined();
  });
});
