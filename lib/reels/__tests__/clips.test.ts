import { describe, expect, it } from "vitest";
import { clipAt, clipStarts, clipsProblem, duplicateClip, flatten, formatEdl, moveClip, outSeconds, overlayInto, parseEdl, snapTo, splitAt, totalSeconds, trimLeft, trimRight, type EditorClip } from "../clips";

const EDL = "a/one.MOV|0.8|2.6|1\na/two.MOV|10|80|40\n\nb/three 2.mov|6|16|8|0.25\n";
const editor = (): EditorClip[] => parseEdl(EDL).map((c, i) => ({ ...c, key: `k${i}`, max: 1000 }));

describe("EDL", () => {
  it("parses shots, skipping blank lines, and writes them back", () => {
    const clips = parseEdl(EDL);
    expect(clips).toEqual([
      { file: "a/one.MOV", in: 0.8, dur: 2.6, speed: 1 },
      { file: "a/two.MOV", in: 10, dur: 80, speed: 40 },
      { file: "b/three 2.mov", in: 6, dur: 16, speed: 8, cropX: 0.25 },
    ]);
    expect(formatEdl(clips)).toBe("a/one.MOV|0.8|2.6|1\na/two.MOV|10|80|40\nb/three 2.mov|6|16|8|0.25\n");
  });

  it("lays clips out on the timeline by their sped-up length", () => {
    const clips = parseEdl(EDL);
    expect(clipStarts(clips)).toEqual([0, 2.6, 4.6]);
    expect(totalSeconds(clips)).toBeCloseTo(6.6);
    expect(clipAt(clips, 3)).toEqual({ index: 1, offset: expect.closeTo(0.4) });
    expect(clipAt(clips, 99)).toEqual({ index: 2, offset: 2 });
    expect(clipAt([], 1)).toBeNull();
  });
});

describe("edge drags", () => {
  const clip = { file: "a", in: 10, dur: 80, speed: 40 };
  it("trims and extends the left edge in source seconds", () => {
    expect(trimLeft(clip, 0.5)).toMatchObject({ in: 30, dur: 60 });
    expect(trimLeft(clip, -0.1)).toMatchObject({ in: 6, dur: 84 });
  });
  it("stops the left edge at the start of the footage and at the minimum length", () => {
    expect(trimLeft(clip, -5)).toMatchObject({ in: 0, dur: 90 });
    expect(trimLeft(clip, 5)).toMatchObject({ in: 82, dur: 8 });
  });
  it("extends the right edge up to the end of the footage, and trims to the minimum length", () => {
    expect(trimRight(clip, 0.5, 1000)).toMatchObject({ in: 10, dur: 100 });
    expect(trimRight(clip, 50, 120)).toMatchObject({ dur: 110 });
    expect(trimRight(clip, -50, 1000)).toMatchObject({ dur: 8 });
  });
});

describe("splitAt and moveClip", () => {
  it("splits the clip under the playhead into two that add up to the original", () => {
    const out = splitAt(editor(), 3.6, "new");
    expect(out.map((c) => c.key)).toEqual(["k0", "k1", "new", "k2"]);
    expect(out[1]).toMatchObject({ in: 10, dur: 40 });
    expect(out[2]).toMatchObject({ in: 50, dur: 40 });
    expect(totalSeconds(out)).toBeCloseTo(6.6);
  });
  it("does not split right at an edge", () => {
    const clips = editor();
    expect(splitAt(clips, 2.65, "new")).toBe(clips);
  });
  it("moves a clip before another, in either direction", () => {
    expect(moveClip(["a", "b", "c", "d"], 0, 3)).toEqual(["b", "c", "a", "d"]);
    expect(moveClip(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveClip(["a", "b", "c"], 0, 3)).toEqual(["b", "c", "a"]);
  });
});

describe("duplicateClip", () => {
  it("duplicates a clip right after itself", () => {
    const out = duplicateClip(editor(), 0, "copy");
    expect(out.map((c) => c.key)).toEqual(["k0", "copy", "k1", "k2"]);
    expect(out[1]).toMatchObject({ file: "a/one.MOV", in: 0.8, dur: 2.6 });
  });
});

describe("top lane", () => {
  const main = (): EditorClip[] => [
    { key: "a", file: "a.mov", in: 0, dur: 4, speed: 1, max: 100 },
    { key: "b", file: "b.mov", in: 10, dur: 40, speed: 20, max: 100 },
    { key: "c", file: "c.mov", in: 5, dur: 3, speed: 1, max: 100 },
  ];
  const top = (at: number, dur: number) => ({ key: "t", file: "t.mov", in: 1, dur, speed: 1, max: 100, at });
  const key = (base: string) => `${base}2`;

  it("replaces a clip it exactly covers, keeping the cut's length", () => {
    const out = overlayInto(main(), top(4, 2), key);
    expect(out.map((c) => c.key)).toEqual(["a", "t", "c"]);
    expect(totalSeconds(out)).toBeCloseTo(9);
    expect(out[1]).not.toHaveProperty("at");
  });
  it("trims the clips it partly covers", () => {
    const out = overlayInto(main(), top(3, 2), key);
    expect(out.map((c) => c.key)).toEqual(["a", "t", "b2", "c"]);
    expect(out[0]).toMatchObject({ in: 0, dur: 3 });
    expect(out[2]).toMatchObject({ in: 30, dur: 20 });
    expect(totalSeconds(out)).toBeCloseTo(9);
  });
  it("splits a clip it lands in the middle of", () => {
    const out = overlayInto(main(), top(1, 2), key);
    expect(out.map((c) => c.key)).toEqual(["a", "t", "a2", "b", "c"]);
    expect(out[2]).toMatchObject({ in: 3, dur: 1 });
  });
  it("extends the cut when it runs past the end", () => {
    expect(totalSeconds(overlayInto(main(), top(8, 3), key))).toBeCloseTo(11);
  });
  it("flattens every top clip, and leaves the cut alone when there are none", () => {
    const m = main();
    expect(flatten({ main: m, over: [] })).toBe(m);
    expect(totalSeconds(flatten({ main: m, over: [top(4, 2), { ...top(0, 1), key: "u" }] }))).toBeCloseTo(9);
  });
  it("snaps to the nearest target within reach", () => {
    expect(snapTo(4.1, [0, 4, 6], 0.2)).toBe(4);
    expect(snapTo(5, [0, 4, 6], 0.2)).toBe(5);
  });
});

describe("clipsProblem", () => {
  const maxOf = (file: string) => (file.startsWith("a/") || file.startsWith("b/") ? 100 : undefined);
  it("accepts a valid list", () => expect(clipsProblem(parseEdl(EDL), maxOf)).toBeNull());
  it("rejects unknown footage, overruns and an empty cut", () => {
    expect(clipsProblem([{ file: "../x.mov", in: 0, dur: 1, speed: 1 }], maxOf)).toMatch(/not footage/);
    expect(clipsProblem([{ file: "a/one.MOV", in: 90, dur: 20, speed: 1 }], maxOf)).toMatch(/past the end/);
    expect(clipsProblem([], maxOf)).toMatch(/no clips/);
  });
});
