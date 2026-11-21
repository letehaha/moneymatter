import { TRACKER_LIMIT_KINDS, type TrackerSpendingByCategoryItem, type TrackerSpendingPeriod } from '@bt/shared/types';
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

/** Exceeding the limit is a win for an income target and a warning otherwise; a target that falls short only warns. */
export const getProjectionTone = ({
  delta,
  isTarget,
}: {
  delta: number | null;
  isTarget: boolean;
}): 'success' | 'warning' | 'destructive' | null => {
  if (delta === null) return null;
  if (isTarget) return delta >= 0 ? 'success' : 'warning';
  return delta > 0 ? 'destructive' : 'success';
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

export const getCategorySplits = ({ items }: { items: TrackerSpendingByCategoryItem[] }) => {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return {
    total,
    items: [...items]
      .sort((a, b) => b.amount - a.amount)
      .map((item) => ({ ...item, percent: getPercent({ part: item.amount, total }) })),
  };
};

export interface CumulativePoint extends TrackerSpendingPeriod {
  /** The period's expense for a spending limit, its income for the income kinds. */
  amount: number;
  cumulative: number;
}

export const getCumulativeSeries = ({
  periods,
  limitKind,
}: {
  periods: TrackerSpendingPeriod[];
  limitKind: TRACKER_LIMIT_KINDS;
}): CumulativePoint[] => {
  const isSpending = limitKind === TRACKER_LIMIT_KINDS.spending;
  let running = 0;
  return [...periods]
    .sort((a, b) => parseISO(a.periodStart).getTime() - parseISO(b.periodStart).getTime())
    .map((period) => {
      running += isSpending ? period.expense - period.income : period.income - period.expense;
      return { ...period, amount: isSpending ? period.expense : period.income, cumulative: Math.max(0, running) };
    });
};
