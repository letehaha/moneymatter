import { CATEGORICAL_SERIES_PALETTE, OTHERS_SERIES_COLOR } from '@/composable/charts/categorical-series-palette';
import type { NetWorthDriversBucket, NetWorthDriversPortfolioMeta } from '@bt/shared/types';
import { differenceInCalendarMonths, differenceInDays, parseISO } from 'date-fns';

import { NET_WORTH_ASSET_KIND_COLORS } from '../../net-worth-history/composables/net-worth-history-derivations';

const DAYS_PER_YEAR = 365.25;

export interface CumulativePoint {
  periodStart: string;
  periodEnd: string;
  /** Running total of savings since the window opened. */
  savedCumulative: number;
  /** Running total of investment growth since the window opened. */
  grownCumulative: number;
  /** This bucket's own contribution, for the tooltip's delta row. */
  savingsNet: number;
  growth: number;
}

/**
 * Running totals from the window's start, which is what the chart plots.
 *
 * The series restart at whatever range the user picked — the chart answers
 * "what happened over this range", so changing the range is meant to reshape
 * the curves.
 */
export const buildCumulativeSeries = ({ buckets }: { buckets: NetWorthDriversBucket[] }): CumulativePoint[] => {
  let savedCumulative = 0;
  let grownCumulative = 0;

  return buckets.map((bucket) => {
    savedCumulative += bucket.savings.net;
    grownCumulative += bucket.investments.growth;

    return {
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      savedCumulative,
      grownCumulative,
      savingsNet: bucket.savings.net,
      growth: bucket.investments.growth,
    };
  });
};

/**
 * Values that seed the growth-crossover target from what the window already
 * shows: the most recent holdings value, and saving averaged over the calendar
 * months the window spans rather than per bucket, so the seed holds whatever
 * granularity the buckets came in and a whole-month window divides cleanly.
 *
 * The seed is a starting point, not a fixed input — the panel lets the user
 * override the saving to model a different future (e.g. dropping a second job).
 */
export const deriveTargetSeeds = ({
  buckets,
}: {
  buckets: NetWorthDriversBucket[];
}): { currentPortfolioValue: number; avgMonthlySavings: number } => {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const currentPortfolioValue = last?.composition.holdingsValue ?? 0;

  if (!first || !last) return { currentPortfolioValue, avgMonthlySavings: 0 };

  const totalSaved = buckets.reduce((sum, bucket) => sum + bucket.savings.net, 0);
  const months = Math.max(differenceInCalendarMonths(parseISO(last.periodEnd), parseISO(first.periodStart)) + 1, 1);

  return { currentPortfolioValue, avgMonthlySavings: totalSaved / months };
};

/**
 * Share of holdings-plus-cash that sits in holdings, as a percentage.
 *
 * Null when the two don't add up to anything positive — a user whose debts
 * outweigh their assets has no meaningful "share in investments", and the ratio
 * would flip sign rather than read as a proportion.
 */
export const computeHoldingsSharePct = ({
  composition,
}: {
  composition: NetWorthDriversBucket['composition'];
}): number | null => {
  const total = composition.holdingsValue + composition.cashValue;
  if (total <= 0) return null;

  return (composition.holdingsValue / total) * 100;
};

interface AllocationContext {
  /** Share of net worth held in investments at the end of the window. */
  currentSharePct: number | null;
  /** The same share a period back, for a "was X%" comparison. */
  referenceSharePct: number | null;
  /** Period end the reference share was taken from, for labelling the span actually used. */
  referencePeriodEnd: string | null;
}

const EMPTY_ALLOCATION_CONTEXT: AllocationContext = {
  currentSharePct: null,
  referenceSharePct: null,
  referencePeriodEnd: null,
};

/**
 * Whether the window holds anything worth plotting.
 *
 * A window of all-zero buckets is indistinguishable from no data to a reader, so
 * it gets the empty state rather than a pair of flat lines on zero.
 */
export const hasAnyData = ({ buckets }: { buckets: NetWorthDriversBucket[] }): boolean =>
  buckets.some(
    (bucket) =>
      bucket.savings.net !== 0 ||
      bucket.investments.growth !== 0 ||
      bucket.composition.holdingsValue !== 0 ||
      bucket.composition.cashValue !== 0,
  );

/**
 * Whether any bucket shows investment activity.
 *
 * Holdings value alone would read as "no portfolios" for someone who sold
 * everything inside the window, so growth and fees — which only a portfolio can
 * produce — count as evidence too.
 */
export const hasPortfolios = ({ buckets }: { buckets: NetWorthDriversBucket[] }): boolean =>
  buckets.some(
    (bucket) =>
      bucket.composition.holdingsValue !== 0 ||
      bucket.investments.growth !== 0 ||
      bucket.investments.priceEffect !== 0 ||
      bucket.investments.dividends !== 0 ||
      bucket.investments.feesAndTaxes !== 0,
  );

/**
 * The current holdings share plus the same share a period back, as a plain
 * "X% now, was Y% then" context fact — no trend or projection.
 *
 * The reference is the bucket nearest a year back, falling back to the oldest
 * one available; the caller labels the span using `referencePeriodEnd` rather
 * than promising a year. With fewer than two buckets carrying a defined share
 * there is nothing to compare against, so only the current share is returned.
 */
export const computeAllocationContext = ({
  buckets,
  referenceYearsBack = 1,
}: {
  buckets: NetWorthDriversBucket[];
  referenceYearsBack?: number;
}): AllocationContext => {
  const withShare = buckets
    .map((bucket) => ({
      periodEnd: bucket.periodEnd,
      sharePct: computeHoldingsSharePct({ composition: bucket.composition }),
    }))
    .filter((entry): entry is { periodEnd: string; sharePct: number } => entry.sharePct !== null);

  const latest = withShare[withShare.length - 1];
  if (!latest) return EMPTY_ALLOCATION_CONTEXT;

  const currentSharePct = latest.sharePct;

  if (withShare.length < 2) {
    return { ...EMPTY_ALLOCATION_CONTEXT, currentSharePct };
  }

  const targetDaysBack = referenceYearsBack * DAYS_PER_YEAR;
  const candidates = withShare.slice(0, -1);
  const reference = candidates.reduce((closest, entry) => {
    const distance = Math.abs(differenceInDays(parseISO(latest.periodEnd), parseISO(entry.periodEnd)) - targetDaysBack);
    const closestDistance = Math.abs(
      differenceInDays(parseISO(latest.periodEnd), parseISO(closest.periodEnd)) - targetDaysBack,
    );
    return distance < closestDistance ? entry : closest;
  }, candidates[0]!);

  return {
    currentSharePct,
    referenceSharePct: reference.sharePct,
    referencePeriodEnd: reference.periodEnd,
  };
};

/** Beyond this many portfolio colours the stack stops being readable, so the tail folds into one segment. */
export const MAX_PORTFOLIO_SERIES = 8;

/** Stands in for a portfolio id on the folded-tail entry; its label comes from i18n, not the API. */
export const OTHERS_SERIES_ID = '__others__';

// Green is reserved for the Saved bar, so the palette's emerald never lands on a portfolio.
const PORTFOLIO_SERIES_PALETTE = CATEGORICAL_SERIES_PALETTE.filter(
  (color) => color !== NET_WORTH_ASSET_KIND_COLORS.cash,
);

export interface BreakdownLegendEntry {
  portfolioId: string;
  /** Empty on the Others entry — the caller labels it from i18n. */
  name: string;
  color: string;
}

export interface BreakdownBar {
  periodStart: string;
  periodEnd: string;
  savedNet: number;
  growthTotal: number;
  /** Dense in legend order, so the stacked renderer never has to look up a missing slice. */
  segments: (BreakdownLegendEntry & { growth: number })[];
}

interface BreakdownModel {
  legend: BreakdownLegendEntry[];
  bars: BreakdownBar[];
}

/**
 * The grouped Saved/Grown bars, with the Grown half split per portfolio.
 *
 * `portfolios` arrives ordered by absolute total growth, so the first
 * MAX_PORTFOLIO_SERIES get their own colour and everything behind them collapses
 * into a single Others segment.
 */
export const buildBreakdownModel = ({
  buckets,
  portfolios,
}: {
  buckets: NetWorthDriversBucket[];
  portfolios: NetWorthDriversPortfolioMeta[];
}): BreakdownModel => {
  const named = portfolios.slice(0, MAX_PORTFOLIO_SERIES);

  const legend: BreakdownLegendEntry[] = named.map((portfolio, index) => ({
    portfolioId: portfolio.portfolioId,
    name: portfolio.name,
    color: PORTFOLIO_SERIES_PALETTE[index % PORTFOLIO_SERIES_PALETTE.length]!,
  }));

  if (portfolios.length > MAX_PORTFOLIO_SERIES) {
    legend.push({ portfolioId: OTHERS_SERIES_ID, name: '', color: OTHERS_SERIES_COLOR });
  }

  const namedIds = new Set(named.map((portfolio) => portfolio.portfolioId));

  const bars = buckets.map((bucket) => {
    const growthByPortfolioId = new Map(
      bucket.investments.byPortfolio.map((slice) => [slice.portfolioId, slice.growth]),
    );
    const othersGrowth = bucket.investments.byPortfolio.reduce(
      (sum, slice) => (namedIds.has(slice.portfolioId) ? sum : sum + slice.growth),
      0,
    );

    const segments = legend.map((entry) => ({
      ...entry,
      growth: entry.portfolioId === OTHERS_SERIES_ID ? othersGrowth : (growthByPortfolioId.get(entry.portfolioId) ?? 0),
    }));

    return {
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      savedNet: bucket.savings.net,
      growthTotal: bucket.investments.growth,
      segments,
    };
  });

  return { legend, bars };
};
