import type { PortfolioValueHistoryInterval, PortfolioValueHistoryPointModel } from '@bt/shared/types/investments';
import { format, startOfYear, subDays, subMonths, subYears } from 'date-fns';

export const CHART_PERIODS = ['1W', '1M', '3M', 'YTD', '1Y', 'ALL'] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];

export type ChartMode = 'value' | 'return';
export type ChartLayout = 'floating' | 'panel';

export interface ChartPoint {
  date: string;
  value: number;
  netDeposits: number;
  costBasis: number;
  /** Return since the period's first point, excluding deposit timing (0.05 = 5%). */
  returnPct: number;
}

/** Every period offered by a portfolio or holding view; each view picks its own subset. */
export type PeriodKey = ChartPeriod | '6M';

export const getPeriodStartDate = ({ period, today }: { period: PeriodKey; today: Date }): string | null => {
  const starts: Record<PeriodKey, Date | null> = {
    '1W': subDays(today, 7),
    '1M': subMonths(today, 1),
    '3M': subMonths(today, 3),
    '6M': subMonths(today, 6),
    YTD: startOfYear(today),
    '1Y': subYears(today, 1),
    ALL: null,
  };
  const start = starts[period];
  return start ? format(start, 'yyyy-MM-dd') : null;
};

/** All-time asks the server to thin a long history to weekly points; other periods fetch daily points from their start. */
export const getHistoryRange = ({
  period,
  today,
}: {
  period: ChartPeriod;
  today: Date;
}): { from: string } | { interval: PortfolioValueHistoryInterval } => {
  const from = getPeriodStartDate({ period, today });
  return from ? { from } : { interval: 'auto' };
};

const hasFiniteValues = (point: PortfolioValueHistoryPointModel) =>
  [point.totalValue, point.netDeposits, point.costBasis, point.timeWeightedReturn].every(
    (value) => value !== null && value !== '' && Number.isFinite(Number(value)),
  );

/**
 * Slices the full daily history to the period and rebases the time-weighted return to its first day.
 * Rows with non-numeric values are skipped; a period whose base return is wiped out (≤ -100%) has no
 * rebased return, so it yields no points.
 */
export const buildChartPoints = ({
  points: allPoints,
  period,
  today,
}: {
  points: PortfolioValueHistoryPointModel[];
  period: ChartPeriod;
  today: Date;
}): ChartPoint[] => {
  const points = allPoints.filter(hasFiniteValues);
  const start = getPeriodStartDate({ period, today });
  const startIndex = start ? points.findIndex((point) => point.date >= start) : 0;
  const startPoint = points[startIndex];
  if (!startPoint) return [];

  const baseGrowth = 1 + Number(startPoint.timeWeightedReturn);
  if (!(baseGrowth > 0)) return [];

  return points.slice(startIndex).map((point) => ({
    date: point.date,
    value: Number(point.totalValue),
    netDeposits: Number(point.netDeposits),
    costBasis: Number(point.costBasis),
    returnPct: (1 + Number(point.timeWeightedReturn)) / baseGrowth - 1,
  }));
};

/** Market gain strips deposits out of the value change, so money moved in never reads as profit. */
export const getPeriodStats = ({ points }: { points: ChartPoint[] }) => {
  const first = points[0];
  const last = points.at(-1);
  if (points.length < 2 || !first || !last) return null;

  return {
    marketGain: last.value - first.value - (last.netDeposits - first.netDeposits),
    returnPct: last.returnPct,
  };
};

/** Value above net deposits; the percentage needs positive deposits to be meaningful. */
export const getTotalReturn = ({ totalValue, netDeposits }: { totalValue: number; netDeposits: number | null }) => {
  if (netDeposits === null) return null;
  const amount = totalValue - netDeposits;
  return { amount, pct: netDeposits > 0 ? amount / netDeposits : null };
};
