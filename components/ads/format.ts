/** Shared display formatters for the Ads page. */

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCurrency(v: number): string {
  return currency.format(v);
}

/** `v` is a fraction (0-1). */
export function formatPercent(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

export function formatCount(v: number): string {
  return v.toLocaleString();
}
