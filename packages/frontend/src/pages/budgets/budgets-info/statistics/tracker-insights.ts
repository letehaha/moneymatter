import type { BudgetSpendingByCategoryItem, BudgetSpendingPeriod } from '@bt/shared/types';
import { differenceInCalendarDays, parseISO } from 'date-fns';

import { parseTrackerDate } from '../../tracker-time-status';

type DateInput = Date | string | null | undefined;

interface TrackerPeriodProgress {
  start: Date;
  end: Date;
  totalDays: number;
  elapsedDays: number;
  isActive: boolean;
}

export const getPeriodProgress = ({
  startDate,
  endDate,
  now = new Date(),
}: {
  startDate: DateInput;
  endDate: DateInput;
  now?: Date;
}): TrackerPeriodProgress | null => {
  const start = parseTrackerDate(startDate);
  const end = parseTrackerDate(endDate);
  if (!start || !end) return null;
  const totalDays = differenceInCalendarDays(end, start) + 1;
  if (totalDays <= 0) return null;

  const dayIndex = differenceInCalendarDays(now, start) + 1;
  return {
    start,
    end,
    totalDays,
    elapsedDays: Math.min(Math.max(dayIndex, 0), totalDays),
    isActive: dayIndex >= 1 && dayIndex <= totalDays,
  };
};

interface TrackerPace {
  dailyPace: number | null;
  allowedPerDay: number | null;
  projectedTotal: number | null;
  projectedDelta: number | null;
}

export const getTrackerPace = ({
  spent,
  limit,
  progress,
}: {
  spent: number;
  limit: number | null | undefined;
  progress: TrackerPeriodProgress | null;
}): TrackerPace => {
  const hasLimit = !!limit && limit > 0;
  const dailyPace = progress && progress.elapsedDays > 0 ? spent / progress.elapsedDays : null;
  const allowedPerDay = progress && hasLimit ? limit / progress.totalDays : null;
  const projectedTotal = progress && dailyPace !== null ? dailyPace * progress.totalDays : null;
  const projectedDelta = projectedTotal !== null && hasLimit ? projectedTotal - limit : null;
  return { dailyPace, allowedPerDay, projectedTotal, projectedDelta };
};

export const getAveragePerDay = ({
  spent,
  firstDate,
  lastDate,
}: {
  spent: number;
  firstDate: DateInput;
  lastDate: DateInput;
}): number | null => {
  const first = parseTrackerDate(firstDate);
  const last = parseTrackerDate(lastDate);
  if (!first || !last) return null;
  const days = differenceInCalendarDays(last, first) + 1;
  return days > 0 ? spent / days : null;
};

export const getPercent = ({ part, total }: { part: number; total: number }): number =>
  total > 0 ? (part / total) * 100 : 0;

export const getCategorySplits = ({ items }: { items: BudgetSpendingByCategoryItem[] }) => {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return {
    total,
    items: [...items]
      .sort((a, b) => b.amount - a.amount)
      .map((item) => ({ ...item, percent: getPercent({ part: item.amount, total }) })),
  };
};

export interface CumulativePoint extends BudgetSpendingPeriod {
  cumulative: number;
}

export const getCumulativeSeries = ({ periods }: { periods: BudgetSpendingPeriod[] }): CumulativePoint[] => {
  let running = 0;
  return [...periods]
    .sort((a, b) => parseISO(a.periodStart).getTime() - parseISO(b.periodStart).getTime())
    .map((period) => {
      running += period.expense - period.income;
      return { ...period, cumulative: Math.max(0, running) };
    });
};
