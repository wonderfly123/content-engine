import { describe, it, expect } from "vitest";
import { nextOpenSlot } from "../slots";

const now = new Date("2026-06-01T10:00:00Z"); // Mon

describe("nextOpenSlot", () => {
  it("returns a slot within the day when cadence has room", () => {
    const slot = nextOpenSlot({
      now,
      channel: "instagram",
      format: "reel",
      cadence: [
        { channel: "instagram", format: "reel", perWeek: 5, enabled: true },
      ],
      occupancy: [],
    });
    expect(slot).not.toBeNull();
    expect(slot!.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("skips an already-scheduled exact time", () => {
    const taken = new Date(now);
    taken.setMinutes(30, 0, 0);
    const slot = nextOpenSlot({
      now,
      channel: "instagram",
      format: "reel",
      cadence: [
        { channel: "instagram", format: "reel", perWeek: 5, enabled: true },
      ],
      occupancy: [{ scheduledFor: taken, channel: "instagram" }],
    });
    expect(slot).not.toBeNull();
    expect(slot!.getTime()).not.toBe(taken.getTime());
  });

  it("respects per-week cap by pushing to next week", () => {
    // 2 already scheduled; cap is 2 → next slot is after now+7d.
    const a = new Date(now);
    a.setHours(now.getHours() + 5);
    const b = new Date(now);
    b.setHours(now.getHours() + 24);
    const slot = nextOpenSlot({
      now,
      channel: "instagram",
      format: "reel",
      cadence: [
        { channel: "instagram", format: "reel", perWeek: 2, enabled: true },
      ],
      occupancy: [
        { scheduledFor: a, channel: "instagram" },
        { scheduledFor: b, channel: "instagram" },
      ],
    });
    expect(slot).not.toBeNull();
    const sevenDaysFromNow = now.getTime() + 7 * 24 * 60 * 60 * 1000;
    expect(slot!.getTime()).toBeGreaterThanOrEqual(sevenDaysFromNow);
  });

  it("clamps to business hours when 'now' is late", () => {
    const lateNight = new Date("2026-06-01T23:30:00");
    const slot = nextOpenSlot({
      now: lateNight,
      channel: "instagram",
      format: "reel",
      cadence: [
        { channel: "instagram", format: "reel", perWeek: 5, enabled: true },
      ],
      occupancy: [],
    });
    expect(slot).not.toBeNull();
    expect(slot!.getHours()).toBeGreaterThanOrEqual(9);
    expect(slot!.getHours()).toBeLessThan(21);
  });

  it("returns null when no slot exists within the lookahead window", () => {
    const slot = nextOpenSlot({
      now,
      channel: "instagram",
      format: "reel",
      cadence: [
        { channel: "instagram", format: "reel", perWeek: 0, enabled: true },
      ],
      occupancy: [],
      maxLookaheadDays: 0,
    });
    expect(slot).toBeNull();
  });
});
