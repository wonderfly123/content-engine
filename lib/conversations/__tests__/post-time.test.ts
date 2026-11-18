import { describe, expect, it } from "vitest";
import { describePostTime, parsePostTime } from "../post-time";

const TZ = "America/Los_Angeles";
// Wednesday Nov 18 2026, 10:00 AM Pacific.
const NOW = new Date("2026-11-18T18:00:00Z");
const pt = (s: string) => {
  const r = parsePostTime(s, NOW, TZ);
  return r ? describePostTime(r.when, NOW, TZ) : null;
};

describe("post times", () => {
  it("understands now, tonight, tomorrow, weekdays and clock times", () => {
    expect(parsePostTime("NOW", NOW, TZ)).toEqual({ when: NOW, now: true });
    expect(pt("tonight")).toBe("today at 7:00 PM");
    expect(pt("Tomorrow")).toBe("tomorrow at 9:00 AM");
    expect(pt("tomorrow 6:30pm")).toBe("tomorrow at 6:30 PM");
    expect(pt("friday 5pm")).toBe("Friday at 5:00 PM");
    expect(pt("6pm")).toBe("today at 6:00 PM");
    expect(pt("6")).toBe("today at 6:00 PM");
    expect(pt("9am")).toBe("tomorrow at 9:00 AM"); // already past today
    expect(pt("post it at 18:00")).toBe("today at 6:00 PM");
  });

  it("rolls tonight to tomorrow once evening has passed, and a weekday to next week", () => {
    const late = new Date("2026-11-19T04:00:00Z"); // 8 PM Pacific
    expect(describePostTime(parsePostTime("tonight", late, TZ)!.when, late, TZ)).toBe("tomorrow at 7:00 PM");
    expect(pt("wednesday 9am")).toBe("Nov 25 at 9:00 AM");
  });

  it("ignores ordinary requests", () => {
    expect(parsePostTime("make it shorter", NOW, TZ)).toBeNull();
    expect(parsePostTime("start with the sign", NOW, TZ)).toBeNull();
    expect(parsePostTime("25pm", NOW, TZ)).toBeNull();
  });
});
