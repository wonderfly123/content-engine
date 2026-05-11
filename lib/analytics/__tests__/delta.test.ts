import { describe, it, expect } from "vitest";
import { computeDelta, formatPct, formatAbs } from "../delta";

describe("computeDelta", () => {
  it("standard up", () => {
    const d = computeDelta(120, 100);
    expect(d.abs).toBe(20);
    expect(d.pct).toBeCloseTo(0.2);
    expect(d.direction).toBe("up");
  });

  it("standard down", () => {
    const d = computeDelta(80, 100);
    expect(d.abs).toBe(-20);
    expect(d.pct).toBeCloseTo(-0.2);
    expect(d.direction).toBe("down");
  });

  it("flat when equal", () => {
    const d = computeDelta(100, 100);
    expect(d.direction).toBe("flat");
  });

  it("prior=0 with non-zero current → pct=null (cannot divide)", () => {
    const d = computeDelta(100, 0);
    expect(d.abs).toBe(100);
    expect(d.pct).toBeNull();
    expect(d.direction).toBe("up");
  });

  it("prior=0 and current=0 → pct=0", () => {
    const d = computeDelta(0, 0);
    expect(d.pct).toBe(0);
    expect(d.direction).toBe("flat");
  });

  it("null inputs return unknown direction", () => {
    const a = computeDelta(null, 10);
    expect(a.direction).toBe("unknown");
    const b = computeDelta(10, undefined);
    expect(b.direction).toBe("unknown");
  });
});

describe("formatters", () => {
  it("formatPct renders signed percentages", () => {
    expect(formatPct(0.12)).toBe("+12.0%");
    expect(formatPct(-0.05)).toBe("-5.0%");
    expect(formatPct(0)).toBe("0.0%");
    expect(formatPct(null)).toBe("—");
  });

  it("formatAbs renders signed counts", () => {
    expect(formatAbs(1500)).toBe("+1,500");
    expect(formatAbs(-3)).toBe("-3");
    expect(formatAbs(null)).toBe("—");
  });
});
