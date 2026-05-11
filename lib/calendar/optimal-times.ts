/**
 * Optimal-time hints for the calendar.
 *
 * Reads `brands.settings_json.patterns.time_heatmap` (written nightly by
 * Pipeline 6) and returns the top-N day-of-week × hour slots per
 * channel × format. If the heatmap is empty, falls back to sensible
 * category defaults (Tue/Thu/Sun, 18:00–21:00 for IG; weekday lunchtime
 * for everything else).
 */

import type { Channel, ContentFormat } from "@/lib/db/enums";

/** Day-of-week: 0 = Sun … 6 = Sat (JS Date.getDay convention). */
export interface OptimalSlot {
  dayOfWeek: number;
  hour: number;
  score: number;
}

/** Shape of the heatmap entry stored in `brands.settings_json.patterns`. */
export interface TimeHeatmapEntry {
  dow: number;
  hour: number;
  score: number;
  channel?: Channel;
  format?: ContentFormat;
}

export interface OptimalTimesInput {
  heatmap?: TimeHeatmapEntry[] | null;
  channel: Channel;
  format: ContentFormat;
  top?: number;
}

/** Returns the top-N slots for the given channel × format. */
export function getOptimalTimes(input: OptimalTimesInput): OptimalSlot[] {
  const { heatmap, channel, format, top = 5 } = input;
  if (heatmap && heatmap.length > 0) {
    const filtered = heatmap.filter(
      (h) =>
        (!h.channel || h.channel === channel) &&
        (!h.format || h.format === format),
    );
    if (filtered.length > 0) {
      const sorted = [...filtered].sort((a, b) => b.score - a.score);
      return sorted.slice(0, top).map((h) => ({
        dayOfWeek: h.dow,
        hour: h.hour,
        score: h.score,
      }));
    }
  }
  return defaultSlotsFor(channel, format).slice(0, top);
}

/** Convenience predicate for components: is this date at a star slot? */
export function isOptimalSlot(date: Date, slots: OptimalSlot[]): boolean {
  const dow = date.getDay();
  const hour = date.getHours();
  return slots.some((s) => s.dayOfWeek === dow && s.hour === hour);
}

// --- category defaults ----------------------------------------------------

const IG_DEFAULTS: OptimalSlot[] = [
  { dayOfWeek: 2, hour: 19, score: 1 }, // Tue 7pm
  { dayOfWeek: 4, hour: 19, score: 1 }, // Thu 7pm
  { dayOfWeek: 0, hour: 20, score: 1 }, // Sun 8pm
  { dayOfWeek: 2, hour: 12, score: 0.7 },
  { dayOfWeek: 4, hour: 12, score: 0.7 },
];

const FB_DEFAULTS: OptimalSlot[] = [
  { dayOfWeek: 1, hour: 13, score: 1 }, // Mon 1pm
  { dayOfWeek: 3, hour: 13, score: 1 }, // Wed 1pm
  { dayOfWeek: 5, hour: 13, score: 1 }, // Fri 1pm
  { dayOfWeek: 2, hour: 18, score: 0.7 },
  { dayOfWeek: 4, hour: 18, score: 0.7 },
];

const GENERIC_DEFAULTS: OptimalSlot[] = [
  { dayOfWeek: 2, hour: 12, score: 1 },
  { dayOfWeek: 3, hour: 12, score: 1 },
  { dayOfWeek: 4, hour: 12, score: 1 },
];

function defaultSlotsFor(channel: Channel, _format: ContentFormat): OptimalSlot[] {
  if (channel === "instagram") return IG_DEFAULTS;
  if (channel === "facebook") return FB_DEFAULTS;
  return GENERIC_DEFAULTS;
}
