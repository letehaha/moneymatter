import { toUtcDateString } from '@common/utils/date';

import { utcInstant } from '../date-ranges';
import { dateParts, dayOfMonthMs, MS_PER_DAY } from '../periods/period-enumerator';

// Dates are `yyyy-MM-dd` UTC calendar days; `end` bounds are exclusive.

const everyNDays = ({ firstMs, endMs, stepDays }: { firstMs: number; endMs: number; stepDays: number }): string[] => {
  const dates: string[] = [];
  for (let ms = firstMs; ms < endMs; ms += stepDays * MS_PER_DAY) dates.push(toUtcDateString(new Date(ms)));
  return dates;
};

/** `weekday` follows `getUTCDay`: 0 is Sunday. */
export const weeklyDates = ({ start, end, weekday }: { start: string; end: string; weekday: number }): string[] => {
  const startMs = utcInstant({ date: start }).getTime();
  const shift = (weekday - new Date(startMs).getUTCDay() + 7) % 7;
  return everyNDays({ firstMs: startMs + shift * MS_PER_DAY, endMs: utcInstant({ date: end }).getTime(), stepDays: 7 });
};

/** Every 14 days from `anchorDate`, in both directions. */
export const biweeklyDates = ({
  start,
  end,
  anchorDate,
}: {
  start: string;
  end: string;
  anchorDate: string;
}): string[] => {
  const startMs = utcInstant({ date: start }).getTime();
  const offset = ((((startMs - utcInstant({ date: anchorDate }).getTime()) / MS_PER_DAY) % 14) + 14) % 14;
  return everyNDays({
    firstMs: startMs + ((14 - offset) % 14) * MS_PER_DAY,
    endMs: utcInstant({ date: end }).getTime(),
    stepDays: 14,
  });
};

/** Clamps to the month's last day, counted from the original date so Jan 31 + 2 months is Mar 31. */
export const addMonths = ({ date, months }: { date: string; months: number }): string => {
  const { year, month, day } = dateParts({ date });
  return toUtcDateString(new Date(dayOfMonthMs({ year, month: month + months, day })));
};

/**
 * The first due date on or after `from`, repeating every `everyMonths` from `anchorDate`.
 * Without a repeat, or when `from` is past a one-off due date, the due date is `anchorDate`.
 */
export const dueCycle = ({
  anchorDate,
  everyMonths,
  from,
}: {
  anchorDate: string;
  everyMonths: number | null;
  from: string;
}): { dueDate: string; previousDueDate: string | null } => {
  if (!everyMonths || anchorDate >= from) return { dueDate: anchorDate, previousDueDate: null };

  const target = dateParts({ date: from });
  const anchor = dateParts({ date: anchorDate });
  const monthGap = (target.year - anchor.year) * 12 + (target.month - anchor.month);
  let index = Math.max(0, Math.floor(monthGap / everyMonths) - 1);
  while (addMonths({ date: anchorDate, months: (index + 1) * everyMonths }) < from) index += 1;

  return {
    dueDate: addMonths({ date: anchorDate, months: (index + 1) * everyMonths }),
    previousDueDate: addMonths({ date: anchorDate, months: index * everyMonths }),
  };
};
