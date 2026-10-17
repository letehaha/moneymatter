import { SUBSCRIPTION_FREQUENCIES } from '@bt/shared/types';
import { addMonths, addWeeks, addYears, max, parseISO } from 'date-fns';

import { calculateNextDueDate } from './calculate-next-due-date';

export const computeNextExpectedDate = ({
  startDate,
  frequency,
  transactions,
}: {
  startDate: string;
  frequency: SUBSCRIPTION_FREQUENCIES;
  transactions?: Array<{ time?: Date | string }>;
}): string | null => {
  const start = parseISO(startDate);
  const now = new Date();

  const txDates = (transactions ?? [])
    .map((tx) => (tx.time ? new Date(tx.time) : null))
    .filter((d): d is Date => d !== null);

  // A start date that hasn't arrived yet is itself the next payment, so nothing is advanced.
  if (txDates.length === 0 && toUtcDay({ date: start }) >= toUtcDay({ date: now })) {
    return toUtcDay({ date: start });
  }

  // Advance from the latest known payment by frequency until we get a future date
  let next = addFrequency({ date: txDates.length > 0 ? max(txDates) : start, frequency });

  while (next < now) {
    next = addFrequency({ date: next, frequency });
  }

  return toUtcDay({ date: next });
};

interface ResolveNextExpectedDateParams {
  startDate: string;
  frequency: SUBSCRIPTION_FREQUENCIES;
  transactions?: Array<{ time?: Date | string }>;
  /** Defaults to active. An inactive subscription has no next date. */
  isActive?: boolean;
  /** A date on or after this makes the subscription over, so there is no next date. */
  endDate?: string | null;
  /** The subscription's scheduled due date (YYYY-MM-DD), when it has a schedule. */
  dueDate?: string | null;
  /** Day of month the schedule is anchored to; falls back to the dueDate's day. */
  anchorDay?: number | null;
  /** Due date of the earliest unpaid, unskipped period, when one exists. */
  openPeriodDueDate?: string | null;
}

/**
 * The next date a subscription is expected to be paid.
 *
 * A subscription with a schedule (an open period, or `dueDate`/`anchorDay`) follows it:
 * the earliest open period's `dueDate`, else the `dueDate` stepped forward on the anchor
 * day until it is not in the past. Without a schedule it falls back to the payment-based
 * estimate (`computeNextExpectedDate`). Null when the subscription is inactive or the
 * resolved date lies beyond its `endDate`.
 */
export const resolveNextExpectedDate = ({
  startDate,
  frequency,
  transactions,
  isActive = true,
  endDate,
  dueDate,
  anchorDay,
  openPeriodDueDate,
}: ResolveNextExpectedDateParams): string | null => {
  if (!isActive) return null;

  const next =
    openPeriodDueDate ??
    computeScheduledDueDate({ frequency, dueDate, anchorDay }) ??
    computeNextExpectedDate({ startDate, frequency, transactions });

  if (next && endDate && next > endDate.slice(0, 10)) return null;

  return next;
};

const computeScheduledDueDate = ({
  frequency,
  dueDate,
  anchorDay,
}: {
  frequency: SUBSCRIPTION_FREQUENCIES;
  dueDate?: string | null;
  anchorDay?: number | null;
}): string | null => {
  if (!dueDate) return null;

  const today = toUtcDay({ date: new Date() });
  const anchor = anchorDay ?? Number(dueDate.slice(8, 10));

  let next = dueDate.slice(0, 10);
  while (next < today) {
    next = calculateNextDueDate({ currentDueDate: next, frequency, anchorDay: anchor });
  }

  return next;
};

const toUtcDay = ({ date }: { date: Date }): string => date.toISOString().split('T')[0]!;

const addFrequency = ({ date, frequency }: { date: Date; frequency: SUBSCRIPTION_FREQUENCIES }): Date => {
  switch (frequency) {
    case SUBSCRIPTION_FREQUENCIES.weekly:
      return addWeeks(date, 1);
    case SUBSCRIPTION_FREQUENCIES.biweekly:
      return addWeeks(date, 2);
    case SUBSCRIPTION_FREQUENCIES.monthly:
      return addMonths(date, 1);
    case SUBSCRIPTION_FREQUENCIES.quarterly:
      return addMonths(date, 3);
    case SUBSCRIPTION_FREQUENCIES.semiAnnual:
      return addMonths(date, 6);
    case SUBSCRIPTION_FREQUENCIES.annual:
      return addYears(date, 1);
    default:
      return addMonths(date, 1);
  }
};
