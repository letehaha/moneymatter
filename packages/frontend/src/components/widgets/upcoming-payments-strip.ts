import type { SubscriptionListItem } from '@/api/subscriptions';
import {
  type SubscriptionDueStatus,
  getSubscriptionDueStatus,
} from '@/pages/planned/subscriptions/subscription-due-status';
import { SUBSCRIPTION_FREQUENCIES, TRANSACTION_TYPES } from '@bt/shared/types';
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  isValid,
  parseISO,
  startOfDay,
} from 'date-fns';

const STRIP_DAYS = 30;

// Offsets from the anchor rather than chained steps, so a month-end date doesn't drift (Jan 31 → Feb 28 → Mar 28).
const NTH_OCCURRENCE: Record<SUBSCRIPTION_FREQUENCIES, (date: Date, n: number) => Date> = {
  [SUBSCRIPTION_FREQUENCIES.weekly]: (date, n) => addWeeks(date, n),
  [SUBSCRIPTION_FREQUENCIES.biweekly]: (date, n) => addWeeks(date, 2 * n),
  [SUBSCRIPTION_FREQUENCIES.monthly]: (date, n) => addMonths(date, n),
  [SUBSCRIPTION_FREQUENCIES.quarterly]: (date, n) => addMonths(date, 3 * n),
  [SUBSCRIPTION_FREQUENCIES.semiAnnual]: (date, n) => addMonths(date, 6 * n),
  [SUBSCRIPTION_FREQUENCIES.annual]: (date, n) => addYears(date, n),
};

export interface StripDay {
  date: Date;
  outflow: number;
  inflow: number;
  status: SubscriptionDueStatus;
}

/**
 * Buckets every occurrence in the next STRIP_DAYS days by day, in base currency.
 * A subscription recurs on its frequency, so a weekly one lands on up to 5 days.
 * An overdue payment is still owed, so it is counted on today.
 *
 * ponytail: ignores `maxOccurrences`, so an installment ending inside the window is drawn past its last payment.
 */
export const buildPaymentsStrip = ({
  subscriptions,
  now,
  toBase,
}: {
  subscriptions: SubscriptionListItem[];
  now: Date;
  toBase: (params: { amount: number; currencyCode: string | null }) => number | null;
}): { days: StripDay[]; totalOutflow: number } => {
  const today = startOfDay(now);
  const days: StripDay[] = Array.from({ length: STRIP_DAYS }, (_, index) => ({
    date: addDays(today, index),
    outflow: 0,
    inflow: 0,
    status: null,
  }));

  for (const sub of subscriptions) {
    if (!sub.nextDueDate || sub.expectedAmount == null) continue;
    const amount = toBase({ amount: Math.abs(sub.expectedAmount), currencyCode: sub.expectedCurrencyCode });
    const first = parseISO(sub.nextDueDate);
    if (amount === null || !isValid(first)) continue;
    const end = sub.endDate ? parseISO(sub.endDate) : null;

    for (let n = 0; ; n++) {
      const date = NTH_OCCURRENCE[sub.frequency](first, n);
      const offset = differenceInCalendarDays(date, today);
      if (offset >= STRIP_DAYS || (n > 0 && end && date > end)) break;
      if (offset < 0 && n > 0) continue;

      const day = days[Math.max(0, offset)]!;
      if (sub.transactionType === TRANSACTION_TYPES.income) day.inflow += amount;
      else day.outflow += amount;

      // Later occurrences are at least a week out, past the due-soon window.
      const status = n === 0 ? getSubscriptionDueStatus({ subscription: sub, now }) : null;
      if (status === 'overdue' || (status === 'dueSoon' && day.status === null)) day.status = status;
    }
  }

  return { days, totalOutflow: days.reduce((sum, day) => sum + day.outflow, 0) };
};
