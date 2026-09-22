import { type BudgetPlanCadence } from '@bt/shared/types/budget-plans';
import { toUtcDateString } from '@common/utils/date';

/**
 * Never date-fns here: it works in the server's local time, so `addDays` across
 * a DST change yields a 6-day week and `addMonths` from the 31st skips April.
 * Integer UTC math only.
 */

export const MAX_BACKDATED_PERIODS = 500;

export type PeriodCadenceConfig = {
  cadence: BudgetPlanCadence;
  intervalN: number;
  anchorDate: string;
  secondAnchorDay: number | null;
};

const DAY_MS = 86_400_000;

const toUtcMs = (date: string): number => {
  const day = toUtcDateString(date);
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
};

const daysInMonth = ({ year, month }: { year: number; month: number }): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const dayOfMonthMs = ({ year, month, day }: { year: number; month: number; day: number }): number =>
  Date.UTC(year, month, Math.min(day, daysInMonth({ year, month })));

const anchorParts = ({ plan }: { plan: PeriodCadenceConfig }) => {
  const anchor = new Date(toUtcMs(plan.anchorDate));
  return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth(), day: anchor.getUTCDate() };
};

const semiMonthlyDays = ({ plan }: { plan: PeriodCadenceConfig }) => {
  const { day } = anchorParts({ plan });
  const second = plan.secondAnchorDay ?? day;
  return { first: Math.min(day, second), second: Math.max(day, second) };
};

/** Index 0 is the anchor boundary (`semi_monthly`: the anchor month's earlier day). */
const boundaryMsAtIndex = ({ plan, index }: { plan: PeriodCadenceConfig; index: number }): number => {
  const { year, month, day } = anchorParts({ plan });

  if (plan.cadence === 'days') return toUtcMs(plan.anchorDate) + index * plan.intervalN * DAY_MS;
  if (plan.cadence === 'months') return dayOfMonthMs({ year, month: month + index * plan.intervalN, day });

  const monthOffset = Math.floor(index / 2);
  const days = semiMonthlyDays({ plan });
  return dayOfMonthMs({
    year,
    month: month + monthOffset,
    day: index - monthOffset * 2 === 0 ? days.first : days.second,
  });
};

const indexAtOrBefore = ({ plan, date }: { plan: PeriodCadenceConfig; date: string }): number => {
  const dateMs = toUtcMs(date);
  const anchor = anchorParts({ plan });

  if (plan.cadence === 'days') {
    return Math.floor((dateMs - toUtcMs(plan.anchorDate)) / DAY_MS / plan.intervalN);
  }

  const target = new Date(dateMs);
  const monthDiff = (target.getUTCFullYear() - anchor.year) * 12 + (target.getUTCMonth() - anchor.month);
  let index = plan.cadence === 'months' ? Math.floor(monthDiff / plan.intervalN) : monthDiff * 2 + 1;
  // The candidate lands in the date's own month, so this steps back at most twice.
  while (boundaryMsAtIndex({ plan, index }) > dateMs) index -= 1;
  return index;
};

export const boundaryAtOrBefore = ({ plan, date }: { plan: PeriodCadenceConfig; date: string }): string =>
  toUtcDateString(new Date(boundaryMsAtIndex({ plan, index: indexAtOrBefore({ plan, date }) })));

export const nextBoundary = ({ plan, after }: { plan: PeriodCadenceConfig; after: string }): string =>
  toUtcDateString(new Date(boundaryMsAtIndex({ plan, index: indexAtOrBefore({ plan, date: after }) + 1 })));

/** Boundaries crossed from `from` to `to`; for two period starts, the periods between them. */
export const countPeriodsBetween = ({
  plan,
  from,
  to,
}: {
  plan: PeriodCadenceConfig;
  from: string;
  to: string;
}): number => indexAtOrBefore({ plan, date: to }) - indexAtOrBefore({ plan, date: from });

/** The wrap-around period is at least 10 days; a clamped month-end day can still shorten the in-month one. */
export const validateSemiMonthlyDays = ({
  anchorDay,
  secondAnchorDay,
}: {
  anchorDay: number;
  secondAnchorDay: number;
}): boolean => {
  const smaller = Math.min(anchorDay, secondAnchorDay);
  const larger = Math.max(anchorDay, secondAnchorDay);
  return larger - smaller >= 10 && smaller + 28 - Math.min(larger, 28) >= 10;
};
