import type { SubscriptionListItem } from '@/api/subscriptions';
import { SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { daysUntilDue, hasUpcomingDue, isSubscriptionOverdue } from './subscription-due-status';
import { buildSubscription } from './subscription-fixtures';

const NOW = new Date(2025, 5, 15, 13, 30);

const scheduled = ({
  nextDueDate,
  periodStatus,
}: {
  nextDueDate: string | null;
  periodStatus?: SUBSCRIPTION_PERIOD_STATUSES;
}): SubscriptionListItem =>
  buildSubscription({
    nextDueDate,
    currentPeriod: periodStatus && nextDueDate ? { id: 'period-1', dueDate: nextDueDate, status: periodStatus } : null,
  });

describe('daysUntilDue', () => {
  it('returns the calendar-day delta for a parseable date', () => {
    expect(daysUntilDue({ dueDate: '2025-06-18', now: NOW })).toBe(3);
    expect(daysUntilDue({ dueDate: '2025-06-13', now: NOW })).toBe(-2);
    expect(daysUntilDue({ dueDate: '2025-06-15', now: NOW })).toBe(0);
  });

  it.each([
    { now: new Date(2025, 5, 15, 0, 1), dueDate: '2025-06-16', expected: 1 },
    { now: new Date(2025, 5, 15, 23, 59), dueDate: '2025-06-16', expected: 1 },
    { now: new Date(2025, 5, 15, 23, 59), dueDate: '2025-06-15', expected: 0 },
    { now: new Date(2025, 5, 15, 0, 0), dueDate: '2025-06-15', expected: 0 },
    { now: new Date(2025, 5, 15, 23, 59), dueDate: '2025-06-14', expected: -1 },
  ])('ignores the time of day on either side ($dueDate)', ({ now, dueDate, expected }) => {
    expect(daysUntilDue({ dueDate, now })).toBe(expected);
  });

  it('counts calendar days across the European DST switch', () => {
    expect(daysUntilDue({ dueDate: '2025-04-02', now: new Date(2025, 2, 28, 23, 30) })).toBe(5);
    expect(daysUntilDue({ dueDate: '2025-03-31', now: new Date(2025, 2, 29, 1, 15) })).toBe(2);
    expect(daysUntilDue({ dueDate: '2025-03-29', now: new Date(2025, 3, 1, 0, 5) })).toBe(-3);
  });

  it.each(['not-a-date', '2025-99-99', ''])('returns null instead of NaN for %j', (dueDate) => {
    expect(daysUntilDue({ dueDate, now: NOW })).toBeNull();
  });
});

describe('isSubscriptionOverdue', () => {
  it('is true for a stored overdue period even when the due date is in the future', () => {
    const subscription = scheduled({
      nextDueDate: '2025-06-18',
      periodStatus: SUBSCRIPTION_PERIOD_STATUSES.overdue,
    });
    expect(isSubscriptionOverdue({ subscription, now: NOW })).toBe(true);
  });

  it('is true for a stored overdue period with an unparseable due date', () => {
    const subscription = scheduled({
      nextDueDate: 'not-a-date',
      periodStatus: SUBSCRIPTION_PERIOD_STATUSES.overdue,
    });
    expect(isSubscriptionOverdue({ subscription, now: NOW })).toBe(true);
  });

  it('is true for a past due date while the stored period is still upcoming', () => {
    const subscription = scheduled({
      nextDueDate: '2025-06-12',
      periodStatus: SUBSCRIPTION_PERIOD_STATUSES.upcoming,
    });
    expect(isSubscriptionOverdue({ subscription, now: NOW })).toBe(true);
  });

  it('is false for today and for future dates', () => {
    expect(isSubscriptionOverdue({ subscription: scheduled({ nextDueDate: '2025-06-15' }), now: NOW })).toBe(false);
    expect(isSubscriptionOverdue({ subscription: scheduled({ nextDueDate: '2025-06-24' }), now: NOW })).toBe(false);
  });

  it('is false for a stored overdue period when there is no next due date (paused or ended)', () => {
    const subscription = buildSubscription({
      nextDueDate: null,
      currentPeriod: { id: 'period-1', dueDate: '2025-06-12', status: SUBSCRIPTION_PERIOD_STATUSES.overdue },
    });
    expect(isSubscriptionOverdue({ subscription, now: NOW })).toBe(false);
  });

  it('is false without a due date', () => {
    expect(isSubscriptionOverdue({ subscription: scheduled({ nextDueDate: null }), now: NOW })).toBe(false);
  });

  it('is false for an unparseable due date without a stored overdue period', () => {
    expect(isSubscriptionOverdue({ subscription: scheduled({ nextDueDate: 'not-a-date' }), now: NOW })).toBe(false);
  });
});

describe('hasUpcomingDue', () => {
  it('is true for an active subscription without an end date', () => {
    expect(hasUpcomingDue({ subscription: { isActive: true, endDate: null }, dueDate: '2025-07-08' })).toBe(true);
  });

  it('is false for an inactive subscription', () => {
    expect(hasUpcomingDue({ subscription: { isActive: false, endDate: null }, dueDate: '2025-07-08' })).toBe(false);
  });

  it('is false when the due date falls after the end date', () => {
    expect(hasUpcomingDue({ subscription: { isActive: true, endDate: '2025-06-30' }, dueDate: '2025-07-08' })).toBe(
      false,
    );
  });

  it('is true when the due date is on or before the end date', () => {
    expect(hasUpcomingDue({ subscription: { isActive: true, endDate: '2025-07-08' }, dueDate: '2025-07-08' })).toBe(
      true,
    );
  });
});
