/**
 * Open-slot computation for the calendar / schedule dialog.
 *
 * Given a brand's cadence rows (per channel × format → per_week) and the set
 * of times that are already scheduled, find the next time that respects:
 *   - cadence weekly quota
 *   - business-hour window (default 09:00–21:00 brand-local)
 *   - 30-minute granularity
 *   - no double-booking with already-scheduled posts for the same channel
 *
 * Pure functions — no DB, no Date.now() side-effects (caller passes `now`).
 */

import { addDays, addMinutes, isSameDay, isAfter } from "date-fns";
import type { Channel, ContentFormat } from "@/lib/db/enums";

export interface CadenceRow {
  channel: Channel;
  format: ContentFormat;
  perWeek: number;
  enabled: boolean;
}

export interface ScheduledOccupancy {
  /** Already-scheduled post times to avoid double-booking. */
  scheduledFor: Date;
  channel: Channel;
}

export interface NextOpenSlotInput {
  now: Date;
  channel: Channel;
  format: ContentFormat;
  cadence: CadenceRow[];
  occupancy: ScheduledOccupancy[];
  /** Earliest hour of day (0–23). Default 9. */
  startHour?: number;
  /** Latest hour of day exclusive (0–24). Default 21. */
  endHour?: number;
  /** Slot granularity in minutes. Default 30. */
  stepMinutes?: number;
  /** Don't search further than this many days out. Default 14. */
  maxLookaheadDays?: number;
}

/**
 * Returns the next available slot for the given channel/format, or `null`
 * if no slot is found within the lookahead window. Honours the cadence
 * weekly quota by skipping days where the per-week count is already met.
 */
export function nextOpenSlot(input: NextOpenSlotInput): Date | null {
  const {
    now,
    channel,
    format,
    cadence,
    occupancy,
    startHour = 9,
    endHour = 21,
    stepMinutes = 30,
    maxLookaheadDays = 14,
  } = input;

  const cadenceRow = cadence.find(
    (c) => c.channel === channel && c.format === format && c.enabled,
  );
  // If cadence disabled, fall back to a reasonable next-day slot.
  const weeklyCap = cadenceRow?.perWeek ?? Infinity;

  // Count how many same-channel posts are scheduled in the current rolling
  // 7-day window starting from `now`. We treat the window as `now …
  // now+7d` so the user always sees room within a week.
  const weekEnd = addDays(now, 7);
  const scheduledThisWeek = occupancy.filter(
    (o) =>
      o.channel === channel &&
      isAfter(o.scheduledFor, now) &&
      o.scheduledFor < weekEnd,
  );

  if (scheduledThisWeek.length >= weeklyCap) {
    // Already at cap — first available slot is in the next week.
    return findFirstFreeSlot({
      from: weekEnd,
      occupancy,
      channel,
      startHour,
      endHour,
      stepMinutes,
      maxLookaheadDays,
    });
  }

  return findFirstFreeSlot({
    from: now,
    occupancy,
    channel,
    startHour,
    endHour,
    stepMinutes,
    maxLookaheadDays,
  });
}

interface FreeSlotInput {
  from: Date;
  occupancy: ScheduledOccupancy[];
  channel: Channel;
  startHour: number;
  endHour: number;
  stepMinutes: number;
  maxLookaheadDays: number;
}

function findFirstFreeSlot(input: FreeSlotInput): Date | null {
  const { from, occupancy, channel, startHour, endHour, stepMinutes, maxLookaheadDays } = input;
  const limit = addDays(from, maxLookaheadDays);

  // Start at next step boundary at or after `from`, clamped into the
  // business-hour window of `from`'s day.
  let cursor = roundUpToStep(from, stepMinutes);
  cursor = clampToBusinessHours(cursor, startHour, endHour);

  const occupiedMs = new Set(
    occupancy
      .filter((o) => o.channel === channel)
      .map((o) => o.scheduledFor.getTime()),
  );

  while (cursor < limit) {
    if (!occupiedMs.has(cursor.getTime())) return cursor;
    cursor = addMinutes(cursor, stepMinutes);
    cursor = clampToBusinessHours(cursor, startHour, endHour);
  }
  return null;
}

function roundUpToStep(d: Date, stepMinutes: number): Date {
  const ms = stepMinutes * 60_000;
  const t = Math.ceil(d.getTime() / ms) * ms;
  return new Date(t);
}

function clampToBusinessHours(d: Date, startHour: number, endHour: number): Date {
  const hour = d.getHours();
  if (hour < startHour) {
    const next = new Date(d);
    next.setHours(startHour, 0, 0, 0);
    return next;
  }
  if (hour >= endHour) {
    // Jump to startHour of the next day.
    const next = addDays(d, 1);
    next.setHours(startHour, 0, 0, 0);
    return next;
  }
  return d;
}

/** Convenience: are two slots on the same day? Re-export for components. */
export const isOnSameDay = isSameDay;
