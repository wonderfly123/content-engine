/**
 * "When should it post?" answers: NOW, TONIGHT (7 PM), TOMORROW [time], a weekday [time], or a
 * time ("6pm", "6:30 pm", "18:00"). Times are in POSTING_TIME_ZONE (Pacific unless set). Pure.
 */
export const DEFAULT_POSTING_TIME_ZONE = "America/Los_Angeles";
export const postingTimeZone = (env: Record<string, string | undefined> = process.env) => env.POSTING_TIME_ZONE?.trim() || DEFAULT_POSTING_TIME_ZONE;

const TONIGHT_HOUR = 19;
const DEFAULT_HOUR = 9;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface Local {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

function local(at: Date, tz: string): Local {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "long", hour12: false })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: DAYS.indexOf(String(parts.weekday).toLowerCase()),
  };
}

/** The instant that is `h:m` on the local calendar day `dayOffset` days after `now`'s, in `tz`. */
function at(now: Date, tz: string, dayOffset: number, h: number, m: number): Date {
  const l = local(now, tz);
  const guess = Date.UTC(l.year, l.month - 1, l.day + dayOffset, h, m);
  // Correct for the zone's offset (twice, for days when it changes).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const seen = local(new Date(t), tz);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    t += guess - seenUtc;
  }
  return new Date(t);
}

/** "6pm" / "6:30 pm" / "18:00" / "6" -> [hour, minute], or null. A bare 1-7 means evening. */
function parseClock(s: string): [number, number] | null {
  const m = /^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (h > 23 || min > 59) return null;
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (!ap && !m[2] && h >= 1 && h <= 7) h += 12;
  if (ap && Number(m[1]) > 12) return null;
  return [h, min];
}

export interface PostTime {
  when: Date;
  /** "now" when it should go out right away. */
  now: boolean;
}

export function parsePostTime(text: string, now: Date = new Date(), tz: string = postingTimeZone()): PostTime | null {
  const s = text.toLowerCase().replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim().replace(/^(post( it)?|schedule( it)?|at|for)\s+/, "");
  if (/^(now|right now|asap|post now|go|immediately)$/.test(s)) return { when: now, now: true };
  const later = (d: Date) => (d.getTime() > now.getTime() + 60_000 ? d : null);

  if (s === "tonight") {
    const t = at(now, tz, 0, TONIGHT_HOUR, 0);
    return { when: later(t) ?? at(now, tz, 1, TONIGHT_HOUR, 0), now: false };
  }
  const tomorrow = /^tomorrow(?:\s+(?:at\s+)?(.+))?$/.exec(s);
  if (tomorrow) {
    if (tomorrow[1] === "night" || tomorrow[1] === "evening") return { when: at(now, tz, 1, TONIGHT_HOUR, 0), now: false };
    if (tomorrow[1] === "morning") return { when: at(now, tz, 1, DEFAULT_HOUR, 0), now: false };
    const clock = tomorrow[1] ? parseClock(tomorrow[1]) : [DEFAULT_HOUR, 0];
    return clock ? { when: at(now, tz, 1, clock[0], clock[1]), now: false } : null;
  }
  const day = /^(?:on\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*(?:\s+(?:at\s+)?(.+))?$/.exec(s);
  if (day) {
    const target = DAYS.findIndex((d) => d.startsWith(day[1].slice(0, 3)));
    const clock = day[2] ? parseClock(day[2]) : [DEFAULT_HOUR, 0];
    if (target < 0 || !clock) return null;
    const today = local(now, tz).weekday;
    let offset = (target - today + 7) % 7;
    if (offset === 0 && !later(at(now, tz, 0, clock[0], clock[1]))) offset = 7;
    return { when: at(now, tz, offset, clock[0], clock[1]), now: false };
  }
  const todayAt = /^(?:today\s+(?:at\s+)?)?(.+?)(?:\s+today)?$/.exec(s);
  const clock = todayAt ? parseClock(todayAt[1]) : null;
  if (!clock) return null;
  const t = at(now, tz, 0, clock[0], clock[1]);
  return { when: later(t) ?? at(now, tz, 1, clock[0], clock[1]), now: false };
}

/** "today at 7:00 PM", "tomorrow at 9:00 AM", "Friday at 5:00 PM", "Nov 25 at 9:00 AM". */
export function describePostTime(when: Date, now: Date = new Date(), tz: string = postingTimeZone()): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(when);
  const a = local(now, tz);
  const b = local(when, tz);
  const days = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(when)} at ${time}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(when)} at ${time}`;
}
