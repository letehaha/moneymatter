import type { GetInvestmentContributionsResponse } from '@bt/shared/types';

/** Minimum bar count before an average is meaningful rather than noise. */
const MIN_BARS_FOR_AVERAGE = 3;

export interface ContributionsChartModel {
  legend: { portfolioId: string; name: string; color: string }[];
  bars: {
    periodStart: string;
    periodEnd: string;
    total: number;
    // Dense in legend order — every portfolio gets a segment even when its
    // amount is 0 this bucket, so a stacked bar renderer never has to look up
    // a missing entry.
    segments: { portfolioId: string; name: string; color: string; amount: number }[];
    // Percent change vs the previous bar's total. Undefined for the first bar,
    // which has nothing to compare against.
    momChangePct: number | undefined;
    // Whether momChangePct is meaningful enough to label: true only when both this
    // bar and the previous one are strictly positive. The exact amounts stay in the
    // tooltip regardless.
    showMomChangeLabel: boolean;
  }[];
  // Mean of bar totals. Null below MIN_BARS_FOR_AVERAGE bars — too few points
  // for "average" to mean anything more than "the numbers you're already seeing".
  average: number | null;
  // rangeTotal spread evenly across the bars in view; 0 when there are none.
  averagePerPeriod: number;
  // Sum of every bar's total.
  rangeTotal: number;
  // Sum of savingsNet across every bucket.
  savingsTotal: number;
}

/**
 * Percent change between two totals, tolerating either side being zero or
 * negative — contributions can go net-negative on a withdrawal-heavy period,
 * unlike the income/expense totals the same math is normally applied to.
 */
const computePctChange = ({ current, previous }: { current: number; previous: number }): number => {
  if (previous === 0) {
    if (current > 0) return 100;
    if (current < 0) return -100;
    return 0;
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
};

/**
 * A period-over-period percent change only reads as meaningful when both totals
 * are strictly positive. A zero baseline, a zero current value, or a sign flip
 * between contribution and withdrawal turns the number into noise, so its label
 * is suppressed — the tooltip still carries the exact amounts.
 */
export const shouldShowMomChangeLabel = ({
  previousTotal,
  currentTotal,
}: {
  previousTotal: number;
  currentTotal: number;
}): boolean => previousTotal > 0 && currentTotal > 0;

export const buildContributionsChartModel = ({
  response,
  palette,
}: {
  response: GetInvestmentContributionsResponse;
  palette: string[];
}): ContributionsChartModel => {
  const legend = response.portfolios.map((portfolio, index) => ({
    portfolioId: portfolio.portfolioId,
    name: portfolio.name,
    color: palette[index % palette.length]!,
  }));

  const bars = response.buckets.map((bucket, index) => {
    const amountByPortfolioId = new Map(bucket.byPortfolio.map((slice) => [slice.portfolioId, slice.amount]));

    const segments = legend.map((entry) => ({
      portfolioId: entry.portfolioId,
      name: entry.name,
      color: entry.color,
      amount: amountByPortfolioId.get(entry.portfolioId) ?? 0,
    }));

    const previousBucket = response.buckets[index - 1];
    const momChangePct =
      previousBucket === undefined
        ? undefined
        : computePctChange({ current: bucket.total, previous: previousBucket.total });
    const showMomChangeLabel =
      previousBucket !== undefined &&
      shouldShowMomChangeLabel({ previousTotal: previousBucket.total, currentTotal: bucket.total });

    return {
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      total: bucket.total,
      segments,
      momChangePct,
      showMomChangeLabel,
    };
  });

  const rangeTotal = bars.reduce((sum, bar) => sum + bar.total, 0);
  const savingsTotal = response.buckets.reduce((sum, bucket) => sum + bucket.savingsNet, 0);
  const average = bars.length < MIN_BARS_FOR_AVERAGE ? null : rangeTotal / bars.length;
  const averagePerPeriod = bars.length ? rangeTotal / bars.length : 0;

  return { legend, bars, average, averagePerPeriod, rangeTotal, savingsTotal };
};

/** The "vs previous period" card metric — compares against a separately fetched, equal-length prior span. */
export const computeVsPreviousPeriodPct = ({
  currentTotal,
  previousTotal,
}: {
  currentTotal: number;
  previousTotal: number;
}): number => computePctChange({ current: currentTotal, previous: previousTotal });

/**
 * What share of total savings got funneled into investments over the range.
 *
 * Null when savings aren't positive — dividing contributions by a zero or
 * negative savings figure wouldn't read as a share of anything.
 */
export const sharePctOfSavings = ({
  rangeTotal,
  savingsTotal,
}: {
  rangeTotal: number;
  savingsTotal: number;
}): number | null => (savingsTotal <= 0 ? null : Math.round((rangeTotal / savingsTotal) * 100));
