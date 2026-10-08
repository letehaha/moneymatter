import type { CashFlowPeriodData } from '@bt/shared/types';
import { differenceInDays, endOfMonth, isSameMonth, parseISO, startOfMonth, subDays, subMonths } from 'date-fns';

interface DatePeriod {
  from: Date;
  to: Date;
}

interface TrendPeriod extends DatePeriod {
  isCurrent: boolean;
}

export interface CashFlowTotals {
  income: number;
  expenses: number;
  netFlow: number;
  // percentage (0-100)
  savingsRate: number;
}

// The trend bars show this many past periods before the current one.
const PREV_PERIOD_COUNT = 5;

/** True when the period spans exactly one whole calendar month. */
export function isFullMonthPeriod({ from, to }: DatePeriod): boolean {
  return isSameMonth(from, to) && from.getDate() === 1 && to.getDate() === endOfMonth(to).getDate();
}

/**
 * The period immediately before the selected one. For a whole month it's the
 * previous calendar month; otherwise it's the same-length window ending the day
 * before `from`.
 */
export function computePrevPeriod({ from, to }: DatePeriod): DatePeriod {
  if (isFullMonthPeriod({ from, to })) {
    const prev = subMonths(from, 1);
    return { from: startOfMonth(prev), to: endOfMonth(prev) };
  }

  const durationInDays = differenceInDays(to, from) + 1;
  return { from: subDays(from, durationInDays), to: subDays(from, 1) };
}

/**
 * The five periods preceding the selected one, plus the selected one itself
 * (flagged `isCurrent`), oldest first — the buckets behind the trend bars.
 */
export function computeTrendPeriods({ from, to }: DatePeriod): [TrendPeriod, ...TrendPeriod[]] {
  const durationInDays = differenceInDays(to, from) + 1;
  const fullMonth = isFullMonthPeriod({ from, to });

  const windowBack = (stepsBack: number): TrendPeriod => {
    if (fullMonth) {
      const periodFrom = startOfMonth(subMonths(from, stepsBack));
      return { from: periodFrom, to: endOfMonth(periodFrom), isCurrent: false };
    }

    const periodTo = subDays(from, (stepsBack - 1) * durationInDays + 1);
    return { from: subDays(periodTo, durationInDays - 1), to: periodTo, isCurrent: false };
  };

  const periods: [TrendPeriod, ...TrendPeriod[]] = [windowBack(PREV_PERIOD_COUNT)];

  for (let i = PREV_PERIOD_COUNT - 1; i >= 1; i--) {
    periods.push(windowBack(i));
  }

  // The selected period is the last (rightmost) bar.
  periods.push({ from, to, isCurrent: true });

  return periods;
}

/**
 * Aggregates the monthly buckets whose start falls inside [from, to] into a
 * single totals object.
 *
 * The cash-flow widget fetches one wide monthly span and slices the current and
 * previous months out of it instead of firing a request per month. This mirrors
 * the endpoint's own totals math (totals = sum of periods, savingsRate =
 * round(netFlow / income * 100)), so a slice of the wide response is identical
 * to a dedicated narrow-range call.
 *
 * Only valid for month-aligned ranges: a partial month can't be reconstructed
 * from a whole-month bucket, so callers fall back to a dedicated call there.
 */
export function sliceCashFlowTotals({
  periods,
  from,
  to,
}: {
  periods: CashFlowPeriodData[];
  from: Date;
  to: Date;
}): CashFlowTotals {
  const fromTime = from.getTime();
  const toTime = to.getTime();

  let income = 0;
  let expenses = 0;

  for (const period of periods) {
    const startTime = parseISO(period.periodStart).getTime();
    if (startTime >= fromTime && startTime <= toTime) {
      income += period.income;
      expenses += period.expenses;
    }
  }

  const netFlow = income - expenses;
  const savingsRate = computeSavingsRate({ income, netFlow }) ?? 0;

  return { income, expenses, netFlow, savingsRate };
}

/** Share of income kept, as a whole percentage. Null when there is no income to divide by. */
export function computeSavingsRate({ income, netFlow }: { income: number; netFlow: number }): number | null {
  return income > 0 ? Math.round((netFlow / income) * 100) : null;
}

// Rates beyond this are drawn at the limit, so one extreme bucket can't flatten the rest of the line.
const SAVINGS_RATE_LIMIT = 100;
// Headroom above the best bucket, so its marker isn't clipped by the plot edge.
const SAVINGS_LINE_TOP_INSET_PERCENT = 8;

interface SavingsRatePoint {
  // Null for a bucket that spent without earning; such a point is always off-scale.
  rate: number | null;
  xPercent: number;
  yPercent: number;
  // Drawn at the scale limit instead of at its own value.
  isOffScale: boolean;
}

/**
 * Lays the per-bucket savings rate out as a line over the trend bars, in
 * percentages of the plot box (x left to right, y top to bottom). The scale
 * runs from 0% at the bottom to the best bucket at the top and extends below
 * zero only when a bucket is negative.
 *
 * A finished bucket that spent without earning sits at the lower limit, so the
 * line runs through the worst periods instead of hiding them. A bucket still in
 * progress gets no point while it would sit at that limit: spending ahead of
 * income is the normal state early in a period, and a point there would squash
 * every other bucket.
 */
export function buildSavingsRateLine({
  buckets,
}: {
  buckets: { income: number; netFlow: number; isInProgress: boolean }[];
}): {
  points: (SavingsRatePoint | null)[];
  // SVG polyline `points` strings, one per unbroken run of two or more points.
  segments: string[];
  zeroYPercent: number | null;
} {
  const plotted = buckets.map(({ income, netFlow, isInProgress }) => {
    const rate = computeSavingsRate({ income, netFlow });

    if (rate === null && netFlow >= 0) return null;

    const value = Math.max(-SAVINGS_RATE_LIMIT, Math.min(SAVINGS_RATE_LIMIT, rate ?? -SAVINGS_RATE_LIMIT));
    if (isInProgress && value === -SAVINGS_RATE_LIMIT) return null;

    return { rate, value };
  });

  const values = plotted.flatMap((p) => (p ? [p.value] : []));
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high - low;

  const toY = (value: number) => {
    if (span === 0) return 100;
    return SAVINGS_LINE_TOP_INSET_PERCENT + ((100 - SAVINGS_LINE_TOP_INSET_PERCENT) * (high - value)) / span;
  };

  const points = plotted.map((p, index) =>
    p
      ? {
          rate: p.rate,
          xPercent: ((index + 0.5) / buckets.length) * 100,
          yPercent: toY(p.value),
          isOffScale: p.rate !== p.value,
        }
      : null,
  );

  const segments: string[] = [];
  let run: string[] = [];
  for (const point of [...points, null]) {
    if (point) {
      run.push(`${point.xPercent},${point.yPercent}`);
      continue;
    }
    if (run.length > 1) segments.push(run.join(' '));
    run = [];
  }

  return { points, segments, zeroYPercent: low < 0 ? toY(0) : null };
}
