import { formatLargeNumber } from '@/js/helpers';
import { maskAmountText } from '@/js/helpers/formatters';

// Point-over-point deltas below one currency unit can't be represented by the
// money formatter (it floors, so they render as "$0") and are visual noise —
// hiding them keeps the eye on the components that actually moved.
const MIN_DISPLAYED_DELTA = 1;

/**
 * Whether a point-over-point balance delta is large enough to surface next to
 * its component in the balance-trend tooltip.
 */
export function shouldDisplayBalanceDelta({ delta }: { delta: number }): boolean {
  return Math.abs(delta) >= MIN_DISPLAYED_DELTA;
}

/**
 * Format a balance delta with an explicit sign. Negatives already carry a "-"
 * from the currency formatter, so only positives get a "+" prefix.
 */
export function formatBalanceDelta({ delta, currency }: { delta: number; currency?: string }): string {
  const formatted = formatLargeNumber(delta, { isFiat: true, currency });
  return delta > 0 ? maskAmountText({ text: `+${formatted}` }) : formatted;
}

/**
 * Format a point-over-point percentage change with an explicit sign and a
 * single decimal, e.g. `+0.6%` / `-1.2%` / `0.0%`.
 */
export function formatBalanceDeltaPercent({ percent }: { percent: number }): string {
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
}
