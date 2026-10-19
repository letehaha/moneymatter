import type { CashFlowPeriodData } from '@bt/shared/types';
import { addDays, format, getDate, getDaysInMonth, startOfMonth, subMonths } from 'date-fns';

export const COMPARISON_MONTHS = 3;
const TONE_THRESHOLD_PERCENT = 5;
export const DEFAULT_SPIKE_PERCENT = 10;
export const SPIKE_PERCENT_MIN = 1;
export const SPIKE_PERCENT_MAX = 100;
const SPIKE_COVERAGE = 0.8;

export const COMPARE_MODES = ['last', 'avg'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];
export type PaceTone = 'over' | 'under' | 'neutral';

type DailyPeriod = Pick<CashFlowPeriodData, 'periodStart' | 'income' | 'expenses'>;

interface PaceComparison {
  cumulative: number[];
  byToday: number;
  total: number;
  forecastCumulative: (number | null)[];
  forecast: number;
  diffPercent: number | null;
  tone: PaceTone;
  monthsCount: number;
}

interface SpendingPace {
  spentCumulative: number[];
  spent: number;
  comparison: PaceComparison | null;
}

const cumulative = ({ values }: { values: number[] }): number[] => {
  let total = 0;
  return values.map((value) => (total += value));
};

/**
 * Daily expenses of the current month up to today, plus the previous calendar months
 * from the user's first month with any cash flow (oldest first).
 */
export const splitDailyExpenses = ({
  periods,
  now,
}: {
  periods: DailyPeriod[];
  now: Date;
}): { currentMonth: number[]; fullMonths: number[][] } => {
  const byDate = new Map(periods.map((period) => [period.periodStart, period]));
  const daysOf = ({ month, length }: { month: Date; length: number }) =>
    Array.from({ length }, (_, i) => byDate.get(format(addDays(month, i), 'yyyy-MM-dd')));
  const toExpenses = ({ days }: { days: (DailyPeriod | undefined)[] }) => days.map((day) => day?.expenses ?? 0);

  const pastMonths = Array.from({ length: COMPARISON_MONTHS }, (_, i) => {
    const month = startOfMonth(subMonths(now, COMPARISON_MONTHS - i));
    return daysOf({ month, length: getDaysInMonth(month) });
  });
  const firstActive = pastMonths.findIndex((days) =>
    days.some((day) => day !== undefined && (day.income !== 0 || day.expenses !== 0)),
  );

  return {
    currentMonth: toExpenses({ days: daysOf({ month: startOfMonth(now), length: getDate(now) }) }),
    fullMonths: firstActive === -1 ? [] : pastMonths.slice(firstActive).map((days) => toExpenses({ days })),
  };
};

/** Shorter months repeat their last day so every day of the current month has a value. */
export const comparisonCumulative = ({
  months,
  daysInMonth,
}: {
  months: number[][];
  daysInMonth: number;
}): number[] | null => {
  if (months.length === 0) return null;
  const cumulatives = months.map((values) => cumulative({ values }));
  return Array.from(
    { length: daysInMonth },
    (_, day) =>
      cumulatives.reduce((total, values) => total + values[Math.min(day, values.length - 1)]!, 0) / cumulatives.length,
  );
};

/** Days whose spend is at least `percent` of the whole month. */
export const spikeDays = ({ values, percent }: { values: number[]; percent: number }): number[] => {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return values.flatMap((value, day) => (value >= (total * percent) / 100 ? [day] : []));
};

/** How many of the largest amounts (sorted desc) it takes to cover most of the day's spend. */
export const spikeContributorsCount = ({ amounts, dayTotal }: { amounts: number[]; dayTotal: number }): number => {
  let covered = 0;
  for (let i = 0; i < amounts.length; i++) {
    covered += amounts[i]!;
    if (covered >= dayTotal * SPIKE_COVERAGE) return i + 1;
  }
  return amounts.length;
};

export const parseSpikePercent = ({ value }: { value: unknown }): number => {
  const percent = Number(value);
  return Number.isInteger(percent) && percent >= SPIKE_PERCENT_MIN && percent <= SPIKE_PERCENT_MAX
    ? percent
    : DEFAULT_SPIKE_PERCENT;
};

export const toneOf = ({ diffPercent }: { diffPercent: number | null }): PaceTone => {
  if (diffPercent === null) return 'neutral';
  if (diffPercent > TONE_THRESHOLD_PERCENT) return 'over';
  if (diffPercent < -TONE_THRESHOLD_PERCENT) return 'under';
  return 'neutral';
};

/** The forecast adds what the comparison spent from today to month end on top of the actual spend. */
export const computeSpendingPace = ({
  currentMonth,
  comparisonMonths,
  daysInMonth,
}: {
  currentMonth: number[];
  comparisonMonths: number[][];
  daysInMonth: number;
}): SpendingPace => {
  const spentCumulative = cumulative({ values: currentMonth });
  const spent = spentCumulative.at(-1) ?? 0;
  const todayIndex = currentMonth.length - 1;
  const comparison = comparisonCumulative({ months: comparisonMonths, daysInMonth });
  if (!comparison) return { spentCumulative, spent, comparison: null };

  const byToday = comparison[todayIndex]!;
  const total = comparison.at(-1)!;
  const forecastCumulative = comparison.map((value, day) => (day < todayIndex ? null : spent + value - byToday));
  const forecast = forecastCumulative.at(-1)!;
  const diffPercent = total > 0 ? ((forecast - total) / total) * 100 : null;

  return {
    spentCumulative,
    spent,
    comparison: {
      cumulative: comparison,
      byToday,
      total,
      forecastCumulative,
      forecast,
      diffPercent,
      tone: toneOf({ diffPercent }),
      monthsCount: comparisonMonths.length,
    },
  };
};

export const parseCompareMode = ({ value }: { value: unknown }): CompareMode =>
  COMPARE_MODES.find((mode) => mode === value) ?? 'avg';

export const formatPacePercent = ({ percent }: { percent: number }): string => {
  const rounded = Math.round(percent);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
};
