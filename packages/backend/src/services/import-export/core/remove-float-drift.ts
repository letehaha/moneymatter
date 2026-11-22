/**
 * Number of decimals kept when cleaning drift: more than any supported currency carries (BTC has 8),
 * and fewer than a double can hold reliably next to an integer part.
 */
const DRIFT_FREE_DECIMALS = 10;

/**
 * Strip the floating-point drift that intermediate arithmetic (negating, summing, `inflow - outflow`)
 * leaves on a monetary decimal, without rounding to any currency's decimals: those apply when the
 * row is written. Shared by the CSV-style importers (Wallet, YNAB) that carry amounts as plain
 * `number` decimals before they reach the `Money` boundary.
 */
export function removeFloatDrift({ n }: { n: number }): number {
  return Number(n.toFixed(DRIFT_FREE_DECIMALS));
}
