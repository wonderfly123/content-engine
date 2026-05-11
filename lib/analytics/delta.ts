/**
 * Period-over-period delta math.
 *
 * `pctChange(current, prior)` handles the edge cases the analytics top-line
 * cards care about: prior=0 with non-zero current → +Infinity surfaced as
 * `null` (UI displays "—"), prior=0 with current=0 → 0, both undefined → null.
 */

export interface Delta {
  /** Absolute change (current - prior). */
  abs: number | null;
  /** Fractional change (0.12 = +12%); null when prior is 0 with non-zero current. */
  pct: number | null;
  direction: "up" | "down" | "flat" | "unknown";
}

export function computeDelta(
  current: number | null | undefined,
  prior: number | null | undefined,
): Delta {
  if (current == null || prior == null) {
    return { abs: null, pct: null, direction: "unknown" };
  }
  const abs = current - prior;
  let pct: number | null;
  if (prior === 0) {
    pct = current === 0 ? 0 : null;
  } else {
    pct = abs / prior;
  }
  const direction: Delta["direction"] =
    abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { abs, pct, direction };
}

/** Format a fractional delta as a signed percentage string. */
export function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${(pct * 100).toFixed(1)}%`;
}

/** Format a count delta with sign. */
export function formatAbs(abs: number | null): string {
  if (abs === null) return "—";
  const sign = abs > 0 ? "+" : "";
  return `${sign}${abs.toLocaleString()}`;
}
