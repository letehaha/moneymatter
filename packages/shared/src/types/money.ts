declare const __cents: unique symbol;
declare const __minorUnits: unique symbol;
declare const __decimal: unique symbol;

/** Branded type representing a value in cents (integer, e.g. 1550 = $15.50). */
export type Cents = number & { readonly [__cents]: true };

/**
 * Branded type representing an integer count of a currency's minor units at its own decimals
 * (10^-decimals of the major unit: cents for USD, fils for KWD, whole yen for JPY).
 * `Cents` is the 2-decimal special case, kept for values that really are cents.
 */
export type MinorUnits = number & { readonly [__minorUnits]: true };

/** Branded type representing a decimal monetary value (e.g. 15.50). */
export type Decimal = number & { readonly [__decimal]: true };

/** Cast a plain number to Cents at a trust boundary (e.g. Monobank API values known to be cents). */
export function asCents(n: number): Cents {
  return n as Cents;
}

/** Cast a plain number to MinorUnits at a trust boundary (e.g. a sum of `toMinorUnits` results). */
export function asMinorUnits(n: number): MinorUnits {
  return n as MinorUnits;
}

/** Cast a plain number to Decimal at a trust boundary. */
export function asDecimal(n: number): Decimal {
  return n as Decimal;
}
