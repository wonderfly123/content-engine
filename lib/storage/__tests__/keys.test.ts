import { describe, expect, it } from "vitest";
import { buildMediaKey, InvalidMediaKeyError, isWorkspaceKey, sanitiseFilename } from "../keys";

const WS = "00000000-0000-4000-8000-0000000000aa";
const OTHER_WS = "00000000-0000-4000-8000-0000000000bb";
const CONV = "00000000-0000-4000-8000-0000000000cc";
const ID = "00000000-0000-4000-8000-0000000000dd";

describe("media keys", () => {
  it("always start with the workspace", () => {
    const key = buildMediaKey({ workspaceId: WS, conversationId: CONV, filename: "IMG_0001.MOV", id: ID });
    expect(key).toBe(`ws/${WS}/conv/${CONV}/raw/${ID}-IMG_0001.MOV`);
    expect(isWorkspaceKey(key, WS)).toBe(true);
    expect(isWorkspaceKey(key, OTHER_WS)).toBe(false);
  });

  it("use a fresh id when none is given, and other kinds when asked", () => {
    const a = buildMediaKey({ workspaceId: WS, conversationId: CONV, filename: "a.mp4" });
    const b = buildMediaKey({ workspaceId: WS, conversationId: CONV, filename: "a.mp4", kind: "preview" });
    expect(a).not.toBe(b.replace("/preview/", "/raw/"));
    expect(b).toMatch(new RegExp(`^ws/${WS}/conv/${CONV}/preview/`));
  });

  it("refuse bad ids", () => {
    expect(() => buildMediaKey({ workspaceId: "../x", conversationId: CONV, filename: "a.mp4" })).toThrow(InvalidMediaKeyError);
    expect(() => buildMediaKey({ workspaceId: WS, conversationId: "nope", filename: "a.mp4" })).toThrow(InvalidMediaKeyError);
    expect(() => buildMediaKey({ workspaceId: WS, conversationId: CONV, filename: "a.mp4", id: "x/y" })).toThrow(InvalidMediaKeyError);
  });

  it("only accept well-formed keys of the workspace", () => {
    expect(isWorkspaceKey(`ws/${WS}/conv/${CONV}/raw/${ID}-a.mp4`, WS)).toBe(true);
    expect(isWorkspaceKey(`ws/${WS}/conv/${CONV}/raw/${ID}-../../ws/${OTHER_WS}/a.mp4`, WS)).toBe(false);
    expect(isWorkspaceKey(`ws/${WS}/../${OTHER_WS}/conv/${CONV}/raw/${ID}-a.mp4`, WS)).toBe(false);
    expect(isWorkspaceKey(`x/ws/${WS}/conv/${CONV}/raw/${ID}-a.mp4`, WS)).toBe(false);
    expect(isWorkspaceKey(null, WS)).toBe(false);
  });
});

describe("filename sanitising", () => {
  it("keeps ordinary names readable", () => {
    expect(sanitiseFilename("IMG_0001.MOV")).toBe("IMG_0001.MOV");
    expect(sanitiseFilename("Beach day (1).mp4")).toBe("Beach-day-1.mp4");
    expect(sanitiseFilename("café ☕ clip.m4v")).toBe("caf-clip.m4v");
    expect(sanitiseFilename(".hidden.mov")).toBe("hidden.mov");
    expect(sanitiseFilename("☕.mov")).toBe("clip.mov");
    expect(sanitiseFilename(`${"a".repeat(200)}.mp4`)).toBe(`${"a".repeat(100)}.mp4`);
  });

  it("rejects path tricks", () => {
    for (const bad of ["../secret.mp4", "..\\secret.mp4", "a/b.mp4", "/etc/passwd", "..", ".", "clip\u0000.mp4", "clip\n.mp4", "", "   "]) {
      expect(() => sanitiseFilename(bad), bad).toThrow(InvalidMediaKeyError);
    }
    expect(() => sanitiseFilename(42)).toThrow(InvalidMediaKeyError);
  });

  it("never lets dots through as a path segment", () => {
    expect(sanitiseFilename("....mp4")).toBe("clip.mp4");
    expect(sanitiseFilename("a..b.mp4")).toBe("a.b.mp4");
  });
});
