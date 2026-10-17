import type { Cents, Decimal, MinorUnits } from '@bt/shared/types';
import Big from 'big.js';

const assertDecimals = ({ decimals, caller }: { decimals: number; caller: string }): void => {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`${caller}: expected a non-negative integer for decimals, got ${decimals}`);
  }
};

/**
 * Immutable Money value object backed by big.js for precise arithmetic.
 *
 * Internal representation: actual decimal value (not cents).
 * - `Money.fromCents(1550)` internally stores Big(15.50)
 * - `Money.fromDecimal(15.50)` internally stores Big(15.50)
 * - Both regular transactions and investments produce the same internal representation
 *
 * Auto-serializes to a JS number via toJSON(), so `res.json({ amount: money })`
 * works without manual conversion for regular transactions.
 *
 * For investment fields with high precision, use `.toDecimalString(dp)` explicitly.
 */
export class Money {
  /** @internal Brand tag for duck-type identification. */
  readonly __isMoney__ = true as const;

  private readonly value: Big;

  private constructor(value: Big) {
    this.value = value;
  }

  /** Reliable check that works across module copies (unlike instanceof). */
  static isMoney(val: unknown): val is Money {
    return val !== null && typeof val === 'object' && (val as { __isMoney__?: boolean }).__isMoney__ === true;
  }

  // ==========================================================================
  // Construction
  // ==========================================================================

  /**
   * Create Money from an integer cents value: for numbers that really are cents (provider minor
   * units). Report engines sum in the currency's own minor units: use `fromMinorUnits`.
   * Divides by 100 to get the actual decimal value.
   *
   * @example
   * Money.fromCents(1550) // represents $15.50
   */
  static fromCents(n: number): Money {
    if (!Number.isFinite(n)) {
      throw new Error(`Money.fromCents: expected finite number, got ${n}`);
    }
    if (!Number.isInteger(n)) {
      throw new Error(`Money.fromCents: expected integer, got ${n}`);
    }
    return new Money(new Big(n).div(100));
  }

  /**
   * Create Money from an integer count of a currency's minor units at its own decimals.
   * `fromMinorUnits({ value, decimals: 2 })` is `fromCents(value)`.
   *
   * @example
   * Money.fromMinorUnits({ value: 1234, decimals: 3 }) // represents 1.234 KWD
   * Money.fromMinorUnits({ value: 1500, decimals: 0 }) // represents 1500 JPY
   */
  static fromMinorUnits({ value, decimals }: { value: number; decimals: number }): Money {
    assertDecimals({ decimals, caller: 'Money.fromMinorUnits' });
    if (!Number.isFinite(value)) {
      throw new Error(`Money.fromMinorUnits: expected finite number, got ${value}`);
    }
    if (!Number.isInteger(value)) {
      throw new Error(`Money.fromMinorUnits: expected integer, got ${value}`);
    }
    return new Money(new Big(value).div(new Big(10).pow(decimals)));
  }

  /**
   * Create Money from a decimal value (number, string, or existing Money).
   * Handles API inputs, DB DECIMAL columns, and investment string values.
   *
   * @example
   * Money.fromDecimal(15.50)           // from API input
   * Money.fromDecimal("102.5000000000") // from investment DB column
   * Money.fromDecimal(existingMoney)    // idempotent passthrough
   */
  static fromDecimal(v: number | string | Money): Money {
    if (Money.isMoney(v)) {
      return v;
    }
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new Error(`Money.fromDecimal: expected finite number, got ${v}`);
    }
    try {
      return new Money(new Big(v));
    } catch {
      throw new Error(`Money.fromDecimal: invalid value "${v}"`);
    }
  }

  /** Create a Money representing zero. */
  static zero(): Money {
    return new Money(new Big(0));
  }

  /**
   * Sum an array of Money values.
   *
   * @example
   * Money.sum(items.map(i => i.amount)) // replaces reduce((sum, x) => sum + x.amount, 0)
   */
  static sum(values: Money[]): Money {
    let total = new Big(0);
    for (const m of values) {
      total = total.plus(m.value);
    }
    return new Money(total);
  }

  // ==========================================================================
  // Arithmetic (always returns new Money)
  // ==========================================================================

  add(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  subtract(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  multiply(factor: number | string): Money {
    return new Money(this.value.times(factor));
  }

  divide(divisor: number | string): Money {
    return new Money(this.value.div(divisor));
  }

  abs(): Money {
    return new Money(this.value.abs());
  }

  negate(): Money {
    return new Money(this.value.times(-1));
  }

  /**
   * Round to `dp` decimal places using ROUND_HALF_UP.
   * Defaults to 2 decimal places.
   */
  round(dp = 2): Money {
    return new Money(this.value.round(dp, Big.roundHalfUp));
  }

  /**
   * Round to `dp` decimal places using ROUND_HALF_EVEN (banker's rounding).
   * Used for converted amounts, where ties must not accumulate a bias.
   */
  roundHalfEven(dp = 2): Money {
    return new Money(this.value.round(dp, Big.roundHalfEven));
  }

  // ==========================================================================
  // Comparison
  // ==========================================================================

  isZero(): boolean {
    return this.value.eq(0);
  }

  isPositive(): boolean {
    return this.value.gt(0);
  }

  isNegative(): boolean {
    return this.value.lt(0);
  }

  equals(other: Money): boolean {
    return this.value.eq(other.value);
  }

  greaterThan(other: Money): boolean {
    return this.value.gt(other.value);
  }

  lessThan(other: Money): boolean {
    return this.value.lt(other.value);
  }

  gte(other: Money): boolean {
    return this.value.gte(other.value);
  }

  lte(other: Money): boolean {
    return this.value.lte(other.value);
  }

  // ==========================================================================
  // Output
  // ==========================================================================

  /**
   * Convert to integer cents, for values that really are cents (provider minor units). Report
   * engines use `toMinorUnits` at the currency's decimals. Money columns are DECIMAL: write the
   * `Money` itself (or `toMoneyColumnValue` in raw SQL), never cents.
   * Multiplies by 100 and rounds.
   *
   * @example
   * Money.fromDecimal(15.50).toCents() // => 1550
   */
  toCents(): Cents {
    return this.value.times(100).round(0, Big.roundHalfUp).toNumber() as Cents;
  }

  /**
   * Convert to an integer count of a currency's minor units at its own decimals, rounding excess
   * precision half-up (away from zero on a tie), as `toCents()` does. `toMinorUnits({ decimals: 2 })`
   * is `toCents()`. Stored amounts are already at their currency's decimals, so rounding only
   * matters for derived values.
   *
   * @example
   * Money.fromDecimal('1.234').toMinorUnits({ decimals: 3 }) // => 1234
   * Money.fromDecimal('1500').toMinorUnits({ decimals: 0 })  // => 1500
   */
  toMinorUnits({ decimals }: { decimals: number }): MinorUnits {
    assertDecimals({ decimals, caller: 'Money.toMinorUnits' });
    // `+ 0` turns a negative zero (from rounding -0.4 to 0 places) into 0.
    return (this.value.times(new Big(10).pow(decimals)).round(0, Big.roundHalfUp).toNumber() + 0) as MinorUnits;
  }

  /**
   * Convert to a fixed-precision string for DECIMAL DB columns.
   *
   * @example
   * Money.fromDecimal("102.5").toDecimalString(10) // => "102.5000000000"
   */
  toDecimalString(dp: number): string {
    return this.value.toFixed(dp);
  }

  /**
   * Return a copy of the internal Big value for arithmetic in investment services
   * that need precise multi-step calculations without Money round-trips.
   */
  toBig(): Big {
    return new Big(this.value);
  }

  /**
   * Convert to a raw JS number.
   * Use for regular transaction amounts in API responses.
   */
  toNumber(): Decimal {
    return this.value.toNumber() as Decimal;
  }

  /**
   * Auto-called by JSON.stringify / res.json().
   * Returns a JS number, which is correct for regular transaction amounts.
   *
   * For investment fields needing high precision, use toDecimalString() explicitly.
   */
  toJSON(): Decimal {
    return this.value.toNumber() as Decimal;
  }

  /** String representation for debugging. */
  toString(): string {
    return this.value.toString();
  }

  /** Allow inspection in Node.js (e.g. console.log). */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `Money(${this.value.toString()})`;
  }
}

/**
 * Convert a Money, or the exact decimal string a `raw: true` query returns for a DECIMAL money
 * column, to an API-friendly decimal number.
 *
 * Use in serializers for model money fields, which are `Money` on hydrated rows and strings on raw rows.
 */
export function moneyToApiDecimal(val: Money | string): Decimal {
  return Money.fromDecimal(val).toNumber();
}

/** Nullable-field variant of `moneyToApiDecimal`: null/undefined pass through as null. */
export function moneyToApiDecimalOrNull(val: Money | string | null | undefined): Decimal | null {
  return val == null ? null : moneyToApiDecimal(val);
}

/**
 * Convert a Money or an integer cents number (provider minor units that really are cents)
 * to an API-friendly decimal number.
 *
 * Only for values that really are cents (provider minor units). Report engines use
 * `minorUnitsToApiDecimal`; model or raw-row money fields use `moneyToApiDecimal`.
 */
export function centsToApiDecimal(val: Money | number): Decimal {
  if (Money.isMoney(val)) return val.toNumber();
  return Money.fromCents(val as number).toNumber();
}

/**
 * Nullable-field variant of `centsToApiDecimal`: null/undefined pass through as
 * null. Use for optional money fields so serializers don't hand-roll the guard
 * ternary.
 */
export function centsToApiDecimalOrNull(val: Money | number | null | undefined): Decimal | null {
  return val == null ? null : centsToApiDecimal(val);
}

/**
 * Convert a Money or an integer count of minor units at the currency's `decimals` (what the report
 * engines sum in memory) to an API-friendly decimal number. At 2 decimals it equals `centsToApiDecimal`.
 */
export function minorUnitsToApiDecimal({ value, decimals }: { value: Money | number; decimals: number }): Decimal {
  if (Money.isMoney(value)) return value.toNumber();
  return Money.fromMinorUnits({ value, decimals }).toNumber();
}

/** Nullable-field variant of `minorUnitsToApiDecimal`: null/undefined pass through as null. */
export function minorUnitsToApiDecimalOrNull({
  value,
  decimals,
}: {
  value: Money | number | null | undefined;
  decimals: number;
}): Decimal | null {
  return value == null ? null : minorUnitsToApiDecimal({ value, decimals });
}

/** Decimal scale for investment DECIMAL columns (precision: 20, scale: 10). */
export const INVESTMENT_DECIMAL_SCALE = 10;

/** Equality of two nullable amounts: two missing values are equal, a missing value never equals an amount. */
export function moneyEqualsOrNull(a: Money | null | undefined, b: Money | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.equals(b);
}
