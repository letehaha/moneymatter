import { Money } from '@common/types/money';
import { differenceInCalendarDays } from 'date-fns';

const DAYS_PER_YEAR = 365.25;

interface ComputePropertyValueParams {
  anchorValue: Money;
  anchorDate: Date;
  asOf: Date;
  /** Signed percent per year. Negative models a declining market. */
  annualRatePct: number;
}

/**
 * Pure appreciation math. No DB, no Date.now() — caller provides `asOf`.
 *
 * `value = anchor * (1 + rate) ^ elapsedYears`, with `elapsedYears` fractional
 * so the curve is smooth day to day rather than stepping on the anniversary of
 * the anchor. Vehicles step year-by-year because their rate changes per year of
 * ownership; a property's rate is constant, so the closed form is both exact
 * and cheaper.
 *
 * Result is floored at zero: a steep enough negative rate over a long enough
 * span would otherwise cross into a negative asset value, which is not a thing.
 *
 * If `asOf` is before `anchorDate`, returns the anchor value unchanged (the
 * caller asked about a date before the property existed for accounting purposes).
 */
export function computePropertyValue({
  anchorValue,
  anchorDate,
  asOf,
  annualRatePct,
}: ComputePropertyValueParams): Money {
  const daysElapsed = differenceInCalendarDays(asOf, anchorDate);
  if (daysElapsed <= 0) {
    return anchorValue;
  }

  const growthFactor = Math.pow(1 + annualRatePct / 100, daysElapsed / DAYS_PER_YEAR);
  const value = anchorValue.multiply(growthFactor);

  return value.isNegative() ? Money.zero() : value;
}
