import { type BudgetPlanCadence } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';

/**
 * Never date-fns here: it works in the server's local time, so `addDays` across
 * a DST change yields a 6-day week and `addMonths` from the 31st skips April.
 * Integer UTC math only.
 */

export const MAX_BACKDATED_PERIODS = 500;
export const FUTURE_PERIODS = 12;
// ponytail: hard ceiling of 10k periods per plan (~27 years daily); raise it if real plans ever approach it.
export const MAX_PLAN_PERIODS = 10_000;

export type PeriodCadenceConfig = {
  cadence: BudgetPlanCadence;
  intervalN: number;
  anchorDate: string;
  secondAnchorDay: number | null;
};

export const MS_PER_DAY = 86_400_000;

export const dateParts = ({ date }: { date: string }) => {
  const iso = toUtcDateString(date);
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1, day: Number(iso.slice(8, 10)) };
};

const daysInMonth = ({ year, month }: { year: number; month: number }): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

export const dayOfMonthMs = ({ year, month, day }: { year: number; month: number; day: number }): number =>
  Date.UTC(year, month, Math.min(day, daysInMonth({ year, month })));

export const anchorParts = ({ plan }: { plan: Pick<PeriodCadenceConfig, 'anchorDate'> }) =>
  dateParts({ date: plan.anchorDate });

/** Index 0 is the anchor boundary (`semi_monthly`: the anchor month's earlier day). */
const boundaryMsAtIndex = ({ plan, index }: { plan: PeriodCadenceConfig; index: number }): number => {
  const { year, month, day } = anchorParts({ plan });

  if (plan.cadence === 'days') return Date.UTC(year, month, day) + index * plan.intervalN * MS_PER_DAY;
  if (plan.cadence === 'months') return dayOfMonthMs({ year, month: month + index * plan.intervalN, day });

  const second = plan.secondAnchorDay ?? day;
  const monthOffset = Math.floor(index / 2);
  return dayOfMonthMs({
    year,
    month: month + monthOffset,
    day: index - monthOffset * 2 === 0 ? Math.min(day, second) : Math.max(day, second),
  });
};

const indexAtOrBefore = ({ plan, date }: { plan: PeriodCadenceConfig; date: string }): number => {
  const target = dateParts({ date });
  const dateMs = Date.UTC(target.year, target.month, target.day);
  const anchor = anchorParts({ plan });

  if (plan.cadence === 'days') {
    return Math.floor((dateMs - Date.UTC(anchor.year, anchor.month, anchor.day)) / MS_PER_DAY / plan.intervalN);
  }

  const monthDiff = (target.year - anchor.year) * 12 + (target.month - anchor.month);
  let index = plan.cadence === 'months' ? Math.floor(monthDiff / plan.intervalN) : monthDiff * 2 + 1;
  // The candidate lands in the date's own month, so this steps back at most twice.
  while (boundaryMsAtIndex({ plan, index }) > dateMs) index -= 1;
  return index;
};

export const nextBoundary = ({
  plan,
  after,
  steps = 1,
}: {
  plan: PeriodCadenceConfig;
  after: string;
  steps?: number;
}): string =>
  toUtcDateString(new Date(boundaryMsAtIndex({ plan, index: indexAtOrBefore({ plan, date: after }) + steps })));

export const boundaryAtOrBefore = ({ plan, date }: { plan: PeriodCadenceConfig; date: string }): string =>
  nextBoundary({ plan, after: date, steps: 0 });

export const currentPeriodStart = ({ plan }: { plan: PeriodCadenceConfig }): string =>
  boundaryAtOrBefore({ plan, date: toUtcDateString(new Date()) });

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
