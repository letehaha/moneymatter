import { toUtcDateString } from '@common/utils/date';

import { DAY_MS, dayOfMonthMs } from '../periods/period-enumerator';

// Dates are `yyyy-MM-dd` UTC calendar days; `end` bounds are exclusive.

const toMs = ({ date }: { date: string }): number =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

const everyNDays = ({ firstMs, endMs, stepDays }: { firstMs: number; endMs: number; stepDays: number }): string[] => {
  const dates: string[] = [];
  for (let ms = firstMs; ms < endMs; ms += stepDays * DAY_MS) dates.push(toUtcDateString(new Date(ms)));
  return dates;
};

/** `weekday` follows `getUTCDay`: 0 is Sunday. */
export const weeklyDates = ({ start, end, weekday }: { start: string; end: string; weekday: number }): string[] => {
  const startMs = toMs({ date: start });
  const shift = (weekday - new Date(startMs).getUTCDay() + 7) % 7;
  return everyNDays({ firstMs: startMs + shift * DAY_MS, endMs: toMs({ date: end }), stepDays: 7 });
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
  const startMs = toMs({ date: start });
  const offset = ((((startMs - toMs({ date: anchorDate })) / DAY_MS) % 14) + 14) % 14;
  return everyNDays({ firstMs: startMs + ((14 - offset) % 14) * DAY_MS, endMs: toMs({ date: end }), stepDays: 14 });
};

/** Clamps to the month's last day, counted from the original date so Jan 31 + 2 months is Mar 31. */
export const addMonths = ({ date, months }: { date: string; months: number }): string => {
  const month = Number(date.slice(5, 7)) - 1 + months;
  return toUtcDateString(
    new Date(dayOfMonthMs({ year: Number(date.slice(0, 4)), month, day: Number(date.slice(8, 10)) })),
  );
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

  const monthGap =
    (Number(from.slice(0, 4)) - Number(anchorDate.slice(0, 4))) * 12 +
    (Number(from.slice(5, 7)) - Number(anchorDate.slice(5, 7)));
  let index = Math.max(0, Math.floor(monthGap / everyMonths) - 1);
  while (addMonths({ date: anchorDate, months: (index + 1) * everyMonths }) < from) index += 1;

  return {
    dueDate: addMonths({ date: anchorDate, months: (index + 1) * everyMonths }),
    previousDueDate: addMonths({ date: anchorDate, months: index * everyMonths }),
  };
};
