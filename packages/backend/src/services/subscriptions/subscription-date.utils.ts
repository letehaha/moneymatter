import { addRecurrenceStep, resolveRecurrenceStep, type RecurrenceInput } from '@bt/shared/subscriptions/recurrence';
import { max, parseISO } from 'date-fns';

export const computeNextExpectedDate = ({
  startDate,
  frequency,
  intervalUnit,
  intervalCount,
  transactions,
}: RecurrenceInput & {
  startDate: string;
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

  // Advance from the latest known payment by the recurrence step until we get a future date
  const step = resolveRecurrenceStep({ frequency, intervalUnit, intervalCount });
  let next = addRecurrenceStep({ date: txDates.length > 0 ? max(txDates) : start, step });

  while (next < now) {
    next = addRecurrenceStep({ date: next, step });
  }

  return toUtcDay({ date: next });
};

type ResolveNextExpectedDateParams = RecurrenceInput & {
  startDate: string;
  transactions?: Array<{ time?: Date | string }>;
  isActive: boolean;
  /** Inclusive last day: a next date after it means the subscription is over. */
  endDate: string | null;
  dueDate: string | null;
  /** Due date of the earliest unpaid, unskipped period, when one exists. */
  openPeriodDueDate?: string | null;
};

/**
 * A scheduled subscription (`dueDate` set) is due on its open period and has no next date
 * once the schedule is consumed; an unscheduled one is estimated from its payments.
 */
export const resolveNextExpectedDate = ({
  startDate,
  frequency,
  intervalUnit,
  intervalCount,
  transactions,
  isActive,
  endDate,
  dueDate,
  openPeriodDueDate,
}: ResolveNextExpectedDateParams): string | null => {
  if (!isActive) return null;

  const next =
    openPeriodDueDate ??
    (dueDate ? null : computeNextExpectedDate({ startDate, frequency, intervalUnit, intervalCount, transactions }));

  if (next && endDate && next > endDate.slice(0, 10)) return null;

  return next;
};

const toUtcDay = ({ date }: { date: Date }): string => date.toISOString().split('T')[0]!;
