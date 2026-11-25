import { CATEGORICAL_SERIES_PALETTE, OTHERS_SERIES_COLOR } from '@/composable/charts/categorical-series-palette';
import {
  ALLOCATION_CASH_KEY,
  PORTFOLIO_BENCHMARK_KEYS,
  type PortfolioBenchmark,
  type PortfolioMonthlyMarketGainModel,
} from '@bt/shared/types/investments';

import type { PricePoint } from '../holding-detail/holding-derivations';
import type { ChartPeriod } from '../portfolio-hero/portfolio-hero-derivations';

export const ANALYTICS_PERIODS = ['1M', '3M', 'YTD', '1Y', 'ALL'] as const satisfies readonly ChartPeriod[];
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const PORTFOLIO_SERIES_COLOR = 'var(--primary)';
export const BENCHMARK_SERIES_COLOR = 'var(--foreground)';

export const resolveBenchmark = ({ stored }: { stored: string | null }): PortfolioBenchmark | null =>
  PORTFOLIO_BENCHMARK_KEYS.find((key) => key === stored) ?? null;

// Violet and purple are left out so no holding is mistaken for the portfolio's primary line.
export const EXCLUDED_SERIES_COLORS = ['rgb(139, 92, 246)', 'rgb(168, 85, 247)'];
const SERIES_PALETTE = CATEGORICAL_SERIES_PALETTE.filter((color) => !EXCLUDED_SERIES_COLORS.includes(color));

export const getHoldingLabel = ({ symbol, name }: { symbol?: string | null; name?: string | null }) =>
  symbol ?? name ?? '—';

/** Colors by position; cash always takes the muted color so it never competes with a named entry. */
export const buildColorMap = ({ keys }: { keys: string[] }): Map<string, string> => {
  let paletteIndex = 0;
  return new Map(
    keys.map((key) => [
      key,
      key === ALLOCATION_CASH_KEY ? OTHERS_SERIES_COLOR : SERIES_PALETTE[paletteIndex++ % SERIES_PALETTE.length]!,
    ]),
  );
};

export interface MonthlyGain {
  month: string;
  gain: number;
}

export const summarizeMonthlyGain = ({ months }: { months: PortfolioMonthlyMarketGainModel[] }) => {
  const values: MonthlyGain[] = months.map(({ month, gain }) => ({ month, gain: Number(gain) }));
  const [first] = values;
  if (!first) return null;

  return {
    values,
    total: values.reduce((sum, { gain }) => sum + gain, 0),
    best: values.reduce((best, entry) => (entry.gain > best.gain ? entry : best), first),
    worst: values.reduce((worst, entry) => (entry.gain < worst.gain ? entry : worst), first),
  };
};

export const DEFAULT_COMPARED_HOLDINGS = 5;
export const MAX_COMPARED_HOLDINGS = 10;

/** No saved list (or a corrupt one) compares the largest holdings; a saved list keeps only ids still held. */
export const resolveComparedIds = ({ stored, heldIds }: { stored: unknown; heldIds: string[] }): string[] => {
  if (!Array.isArray(stored)) return heldIds.slice(0, DEFAULT_COMPARED_HOLDINGS);
  const held = new Set(heldIds);
  return [...new Set(stored)].filter((id) => held.has(id)).slice(0, MAX_COMPARED_HOLDINGS);
};

/** Closes within `[startDate, endDate]` as the price return since the first of them. */
export const rebasePriceSeries = ({
  points,
  startDate,
  endDate,
}: {
  points: PricePoint[];
  startDate: string;
  endDate: string;
}): { date: string; value: number }[] => {
  const window = points.filter(({ date }) => date >= startDate && date <= endDate);
  const base = window[0]?.close;
  return base ? window.map(({ date, close }) => ({ date, value: close / base - 1 })) : [];
};

export interface AllocationOther {
  count: number;
  value: number;
  weight: number;
}

/** Folds entries under `minWeight` into one, unless that would fold a single entry or leave fewer than 2 others. */
export const groupAllocationTail = <T extends { value: number; weight: number }>({
  entries,
  minWeight,
}: {
  entries: T[];
  minWeight: number;
}): { kept: T[]; other: AllocationOther | null } => {
  const kept = entries.filter(({ weight }) => weight >= minWeight);
  const tail = entries.filter(({ weight }) => weight < minWeight);
  if (tail.length < 2 || kept.length < 2) return { kept: entries, other: null };

  return {
    kept,
    other: {
      count: tail.length,
      value: tail.reduce((sum, { value }) => sum + value, 0),
      weight: tail.reduce((sum, { weight }) => sum + weight, 0),
    },
  };
};

/** Every n-th label so neighbours keep at least `minLabelWidth` pixels between them. */
export const getLabelStep = ({
  count,
  width,
  minLabelWidth,
}: {
  count: number;
  width: number;
  minLabelWidth: number;
}) => {
  const fitting = Math.max(1, Math.floor(width / minLabelWidth));
  return Math.max(1, Math.ceil(count / fitting));
};
