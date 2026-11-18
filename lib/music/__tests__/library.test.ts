import { describe, expect, it } from "vitest";
import { musicKey, parseMusicIndex, trackTitle } from "../library";

describe("music index", () => {
  const tsv = [
    "track\tseconds\tbpm\tfirst_beat\tbeat_strength\tloudest_15s_from",
    "from-clips/micro-2.mp3\t14.4\t99.25\t0.046\t7.06\t0",
    "trending-11-10-26/07.mp3\t31.2\t\t\t\t",
    "../secret.mp3\t3\t90\t0\t1\t0",
    "notes.txt\t1\t1\t1\t1\t1",
    "",
  ].join("\n");

  it("reads tracks with their beat data, blanks as null, and skips anything that isn't a safe audio path", () => {
    expect(parseMusicIndex(tsv)).toEqual([
      { path: "from-clips/micro-2.mp3", seconds: 14.4, bpm: 99.25, firstBeat: 0.046, beatStrength: 7.06, loudestFrom: 0 },
      { path: "trending-11-10-26/07.mp3", seconds: 31.2, bpm: null, firstBeat: null, beatStrength: null, loudestFrom: null },
    ]);
  });

  it("keys tracks under music/library/ with safe characters, and titles them readably", () => {
    expect(musicKey("Trending 11/My Song!.mp3")).toBe("music/library/trending-11/my-song-.mp3");
    expect(trackTitle("trending-11-10-26/07.mp3")).toBe("Trending 11-10-26 · 07");
    expect(trackTitle("from-clips/micro-2.mp3")).toBe("From clips · micro-2");
  });
});
