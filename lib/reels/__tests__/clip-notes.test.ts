import { describe, expect, it } from "vitest";
import { clipNoteLabel, pinClipNotes } from "../clip-notes";
import { parseEdl } from "../clips";

// Timeline: clip 1 0-2.6s, clip 2 (40x timelapse) 2.6-4.6s, clip 3 (8x) 4.6-6.6s.
const clips = parseEdl("a/one.MOV|0.8|2.6|1\n../turf/footage/two.MOV|10|80|40\nb/three.mov|6|16|8|0.25\n");

describe("pinClipNotes", () => {
  it("pins a whole-clip note to the clip's footage", () => {
    expect(pinClipNotes(clips, [{ clip: 1, from: 0, to: 2.6, text: " Make this shorter " }])).toEqual([
      { clip: 1, file: "a/one.MOV", from: 0.8, to: 3.4, at: 0, until: 2.6, whole: true, text: "Make this shorter" },
    ]);
  });

  it("turns a section of a sped-up clip into source seconds", () => {
    const [note] = pinClipNotes(clips, [{ clip: 2, from: 3.1, to: 3.6, text: "the good part" }]);
    expect(note).toMatchObject({ file: "../turf/footage/two.MOV", from: 30, to: 50, at: 3.1, until: 3.6, whole: false });
  });

  it("keeps a section inside its clip and snaps near-edges to the edge", () => {
    const [note] = pinClipNotes(clips, [{ clip: 3, from: 4.0, to: 6.58, text: "x" }]);
    expect(note).toMatchObject({ at: 4.6, until: 6.6, from: 6, to: 22, whole: true });
  });

  it("orders notes by where they sit in the cut", () => {
    const notes = pinClipNotes(clips, [{ clip: 3, from: 4.6, to: 6.6, text: "c" }, { clip: 1, from: 1, to: 2, text: "b" }, { clip: 1, from: 0, to: 2.6, text: "a" }]);
    expect(notes.map((n) => n.text)).toEqual(["a", "b", "c"]);
  });

  it("refuses notes that do not fit the cut", () => {
    expect(() => pinClipNotes(clips, [{ clip: 4, from: 0, to: 1, text: "x" }])).toThrow("clip 4 is not in this cut");
    expect(() => pinClipNotes(clips, [{ clip: 1.5, from: 0, to: 1, text: "x" }])).toThrow("not in this cut");
    expect(() => pinClipNotes(clips, [{ clip: 1, from: 0, to: 1, text: "  " }])).toThrow("empty");
    expect(() => pinClipNotes(clips, [{ clip: 1, from: 1, to: 1.02, text: "x" }])).toThrow("too short");
    expect(() => pinClipNotes(clips, [{ clip: 2, from: 0, to: 1, text: "x" }])).toThrow("too short");
  });
});

describe("clipNoteLabel", () => {
  it("names the clip, and the section when it is only part of it", () => {
    expect(clipNoteLabel({ clip: 7, at: 12.4, until: 14.9, whole: true })).toBe("Clip 7");
    expect(clipNoteLabel({ clip: 7, at: 12.92, until: 13.4, whole: false })).toBe("Clip 7, 12.9s to 13.4s");
  });
});
