/**
 * Round a monetary decimal to 2 decimal places, whatever the currency's own decimals are, killing floating-point drift
 * introduced by intermediate arithmetic (negating, summing, `inflow - outflow`).
 * Shared by the CSV-style importers (Wallet, YNAB) that carry amounts as plain
 * `number` decimals before they reach the `Money` boundary.
 */
export function roundCurrency({ n }: { n: number }): number {
  return Math.round(n * 100) / 100;
}
