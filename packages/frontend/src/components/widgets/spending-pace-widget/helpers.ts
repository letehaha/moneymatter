import { getPayPeriod } from '@/composable/use-period-navigation';
import type { CashFlowPeriodData } from '@bt/shared/types';
import { addDays, addMonths, differenceInCalendarDays, format, subMonths } from 'date-fns';

export const COMPARISON_MONTHS = 3;
const TONE_THRESHOLD_PERCENT = 5;
export const DEFAULT_SPIKE_PERCENT = 10;
export const SPIKE_PERCENT_MIN = 1;
export const SPIKE_PERCENT_MAX = 100;
// The history-based forecast already contains repeating expenses, so plans for them count twice
// unless the user opts in.
export const INCLUDE_PLANNED_DEFAULT = false;
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

const daysInPayMonth = ({ start }: { start: Date }) => differenceInCalendarDays(addMonths(start, 1), start);

/** The pay month containing `now`; payday 1 is the calendar month. Indexes are 0-based days from its start. */
export const getPayMonth = ({ now, payday = 1 }: { now: Date; payday?: number }) => {
  const { from: start, to: end } = getPayPeriod({ date: now, payday });
  const daysInMonth = daysInPayMonth({ start });
  const todayIndex = differenceInCalendarDays(now, start);
  return {
    start,
    end,
    prevStart: subMonths(start, 1),
    daysInMonth,
    todayIndex,
    daysLeft: daysInMonth - todayIndex - 1,
  };
};

/**
 * Daily expenses of the current pay month up to today, plus the previous pay months
 * from the user's first month with any cash flow (oldest first).
 */
export const splitDailyExpenses = ({
  periods,
  now,
  payday = 1,
}: {
  periods: DailyPeriod[];
  now: Date;
  payday?: number;
}): { currentMonth: number[]; fullMonths: number[][] } => {
  const byDate = new Map(periods.map((period) => [period.periodStart, period]));
  const daysOf = ({ month, length }: { month: Date; length: number }) =>
    Array.from({ length }, (_, i) => byDate.get(format(addDays(month, i), 'yyyy-MM-dd')));
  const toExpenses = ({ days }: { days: (DailyPeriod | undefined)[] }) => days.map((day) => day?.expenses ?? 0);

  const { start, todayIndex } = getPayMonth({ now, payday });
  const pastMonths = Array.from({ length: COMPARISON_MONTHS }, (_, i) => {
    const month = subMonths(start, COMPARISON_MONTHS - i);
    return daysOf({ month, length: daysInPayMonth({ start: month }) });
  });
  const firstActive = pastMonths.findIndex((days) =>
    days.some((day) => day !== undefined && (day.income !== 0 || day.expenses !== 0)),
  );

  return {
    currentMonth: toExpenses({ days: daysOf({ month: start, length: todayIndex + 1 }) }),
    fullMonths: firstActive === -1 ? [] : pastMonths.slice(firstActive).map((days) => toExpenses({ days })),
  };
};

/** What planned rows add on top of actual spend, indexed by pay-month day; zero before today. */
export const upcomingPlannedExpenses = ({
  actualPeriods,
  withPlannedPeriods,
  now,
  payday = 1,
}: {
  actualPeriods: DailyPeriod[];
  withPlannedPeriods: DailyPeriod[];
  now: Date;
  payday?: number;
}): number[] => {
  const { start, daysInMonth, todayIndex } = getPayMonth({ now, payday });
  const expensesByDate = ({ periods }: { periods: DailyPeriod[] }) =>
    new Map(periods.map((period) => [period.periodStart, period.expenses]));
  const actual = expensesByDate({ periods: actualPeriods });
  const withPlanned = expensesByDate({ periods: withPlannedPeriods });

  return Array.from({ length: daysInMonth }, (_, day) => {
    if (day < todayIndex) return 0;
    const date = format(addDays(start, day), 'yyyy-MM-dd');
    return (withPlanned.get(date) ?? 0) - (actual.get(date) ?? 0);
  });
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

/**
 * The forecast adds what the comparison spent from today to month end, plus pending plans, on top
 * of the actual spend. Today's chart point stays the actual spend so the line starts at the today dot.
 */
export const computeSpendingPace = ({
  currentMonth,
  comparisonMonths,
  daysInMonth,
  plannedExpenses = [],
}: {
  currentMonth: number[];
  comparisonMonths: number[][];
  daysInMonth: number;
  plannedExpenses?: number[];
}): SpendingPace => {
  const spentCumulative = cumulative({ values: currentMonth });
  const spent = spentCumulative.at(-1) ?? 0;
  const todayIndex = currentMonth.length - 1;
  const comparison = comparisonCumulative({ months: comparisonMonths, daysInMonth });
  if (!comparison) return { spentCumulative, spent, comparison: null };

  const byToday = comparison[todayIndex]!;
  const total = comparison.at(-1)!;
  const plannedCumulative = cumulative({ values: plannedExpenses });
  const forecastCumulative = comparison.map((value, day) => {
    if (day < todayIndex) return null;
    if (day === todayIndex) return spent;
    return spent + value - byToday + (plannedCumulative[day] ?? 0);
  });
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
