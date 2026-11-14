import { describe, expect, it } from "vitest";
import { NO_TRIM, isEdited, isValidKeep, keptRanges, keptSeconds, playableAt, trimFromKeep } from "../edits";

describe("keptRanges", () => {
  it("keeps the whole video when nothing is trimmed", () => {
    const keep = keptRanges(NO_TRIM, 30);
    expect(keep).toEqual([{ from: 0, to: 30 }]);
    expect(isEdited(keep, 30)).toBe(false);
  });

  it("trims the start and end", () => {
    const keep = keptRanges({ start: 2, end: 28, removed: [] }, 30);
    expect(keep).toEqual([{ from: 2, to: 28 }]);
    expect(keptSeconds(keep)).toBe(26);
    expect(isEdited(keep, 30)).toBe(true);
  });

  it("cuts sections out, merging overlaps and accepting them in any order or direction", () => {
    const keep = keptRanges({ start: 0, end: null, removed: [{ from: 20, to: 22 }, { from: 8, to: 5 }, { from: 7, to: 10 }] }, 30);
    expect(keep).toEqual([{ from: 0, to: 5 }, { from: 10, to: 20 }, { from: 22, to: 30 }]);
    expect(keptSeconds(keep)).toBe(23);
  });

  it("clamps to the video and drops slivers", () => {
    expect(keptRanges({ start: -4, end: 99, removed: [{ from: 0.05, to: 12 }] }, 30)).toEqual([{ from: 12, to: 30 }]);
  });

  it("returns nothing when everything is cut", () => {
    expect(keptRanges({ start: 10, end: 5, removed: [] }, 30)).toEqual([]);
  });
});

describe("trimFromKeep", () => {
  it("round-trips through keptRanges", () => {
    const keep = [{ from: 1, to: 5 }, { from: 10, to: 20 }];
    expect(keptRanges(trimFromKeep(keep), 30)).toEqual(keep);
  });
});

describe("playableAt", () => {
  const keep = [{ from: 2, to: 5 }, { from: 10, to: 20 }];
  it("stays put inside a kept range", () => expect(playableAt(keep, 3)).toBe(3));
  it("jumps to the start before the first range", () => expect(playableAt(keep, 0)).toBe(2));
  it("jumps over a cut section", () => expect(playableAt(keep, 6)).toBe(10));
  it("ends after the last range", () => expect(playableAt(keep, 20)).toBeNull());
});

describe("isValidKeep", () => {
  it("accepts ordered ranges", () => expect(isValidKeep([{ from: 0, to: 5 }, { from: 5, to: 9 }])).toBe(true));
  it("rejects overlaps, reversed ranges and nothing", () => {
    expect(isValidKeep([{ from: 0, to: 5 }, { from: 4, to: 9 }])).toBe(false);
    expect(isValidKeep([{ from: 5, to: 2 }])).toBe(false);
    expect(isValidKeep([])).toBe(false);
  });
});
