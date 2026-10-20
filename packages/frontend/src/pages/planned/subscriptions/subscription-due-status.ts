import type { SubscriptionListItem } from '@/api/subscriptions';
import { SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { differenceInCalendarDays, isValid, parseISO, startOfDay } from 'date-fns';

/** Null for an unparseable date, so callers branch explicitly instead of comparing NaN. */
export const daysUntilDue = ({ dueDate, now }: { dueDate: string; now: Date }): number | null => {
  const parsed = parseISO(dueDate);
  if (!isValid(parsed)) return null;
  return differenceInCalendarDays(parsed, startOfDay(now));
};

/** False when the subscription is paused or the due date falls after its end date. */
export const hasUpcomingDue = ({
  subscription,
  dueDate,
}: {
  subscription: Pick<SubscriptionListItem, 'isActive' | 'endDate'>;
  dueDate: string;
}): boolean => {
  if (!subscription.isActive) return false;
  return !subscription.endDate || dueDate.slice(0, 10) <= subscription.endDate.slice(0, 10);
};

// Overdue when the open period is stored overdue, or when the effective next date has
// already passed — the latter covers an `upcoming` period whose due date slipped before
// the daily cron flips the stored status, so a past date never shows "in -1 days".
export const isSubscriptionOverdue = ({
  subscription,
  now,
}: {
  subscription: SubscriptionListItem;
  now: Date;
}): boolean => {
  if (!subscription.nextDueDate) return false;
  if (subscription.currentPeriod?.status === SUBSCRIPTION_PERIOD_STATUSES.overdue) return true;
  const days = daysUntilDue({ dueDate: subscription.nextDueDate, now });
  if (days === null) return false;
  return days < 0;
};

const DUE_SOON_DAYS = 3;

export type SubscriptionDueStatus = 'overdue' | 'dueSoon' | null;

export const getSubscriptionDueStatus = ({
  subscription,
  now,
}: {
  subscription: SubscriptionListItem;
  now: Date;
}): SubscriptionDueStatus => {
  if (isSubscriptionOverdue({ subscription, now })) return 'overdue';
  if (!subscription.nextDueDate) return null;
  const days = daysUntilDue({ dueDate: subscription.nextDueDate, now });
  return days !== null && days <= DUE_SOON_DAYS ? 'dueSoon' : null;
};
