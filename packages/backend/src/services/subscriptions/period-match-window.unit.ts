import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { matchToleranceDays, pickNearestOpenPeriod } from './period-match-window';

describe('matchToleranceDays', () => {
  it.each([
    [SUBSCRIPTION_FREQUENCIES.weekly, 3],
    [SUBSCRIPTION_FREQUENCIES.biweekly, 7],
    [SUBSCRIPTION_FREQUENCIES.monthly, 15],
    [SUBSCRIPTION_FREQUENCIES.quarterly, 45],
    [SUBSCRIPTION_FREQUENCIES.semiAnnual, 90],
    [SUBSCRIPTION_FREQUENCIES.annual, 182],
  ])('is half the interval for %s', (frequency, expected) => {
    expect(matchToleranceDays({ frequency })).toBe(expected);
  });

  it.each([
    [SUBSCRIPTION_INTERVAL_UNITS.day, 30, 15],
    [SUBSCRIPTION_INTERVAL_UNITS.day, 1, 0],
    [SUBSCRIPTION_INTERVAL_UNITS.week, 3, 10],
    [SUBSCRIPTION_INTERVAL_UNITS.month, 2, 30],
    [SUBSCRIPTION_INTERVAL_UNITS.year, 2, 365],
  ])('is half the interval for custom %s×%i', (intervalUnit, intervalCount, expected) => {
    expect(matchToleranceDays({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit, intervalCount })).toBe(
      expected,
    );
  });
});

describe('pickNearestOpenPeriod', () => {
  const monthly = SUBSCRIPTION_FREQUENCIES.monthly;

  it('picks a period 2 days after the transaction', () => {
    const result = pickNearestOpenPeriod({
      periods: [{ id: 'a', dueDate: '2025-06-10' }],
      transactionTime: new Date('2025-06-08T09:00:00Z'),
      frequency: monthly,
    });
    expect(result?.id).toBe('a');
  });

  it('returns null when the closest period is 40 days away', () => {
    const result = pickNearestOpenPeriod({
      periods: [{ id: 'a', dueDate: '2025-06-10' }],
      transactionTime: new Date('2025-07-20T00:00:00Z'),
      frequency: monthly,
    });
    expect(result).toBeNull();
  });

  it('includes the window boundary and excludes one day beyond it', () => {
    const periods = [{ id: 'a', dueDate: '2025-06-10' }];
    expect(
      pickNearestOpenPeriod({ periods, transactionTime: new Date('2025-06-25T23:00:00Z'), frequency: monthly })?.id,
    ).toBe('a');
    expect(
      pickNearestOpenPeriod({ periods, transactionTime: new Date('2025-06-26T00:00:00Z'), frequency: monthly }),
    ).toBeNull();
  });

  it('picks the nearest of several periods, earlier due date on a tie', () => {
    const periods = [
      { id: 'late', dueDate: '2025-06-20' },
      { id: 'early', dueDate: '2025-06-10' },
    ];
    expect(
      pickNearestOpenPeriod({ periods, transactionTime: new Date('2025-06-18T00:00:00Z'), frequency: monthly })?.id,
    ).toBe('late');
    expect(
      pickNearestOpenPeriod({ periods, transactionTime: new Date('2025-06-15T00:00:00Z'), frequency: monthly })?.id,
    ).toBe('early');
  });

  it('uses the narrower weekly window', () => {
    const periods = [{ id: 'a', dueDate: '2025-06-10' }];
    const weekly = SUBSCRIPTION_FREQUENCIES.weekly;
    expect(
      pickNearestOpenPeriod({ periods, transactionTime: new Date('2025-06-13T00:00:00Z'), frequency: weekly })?.id,
    ).toBe('a');
    expect(
      pickNearestOpenPeriod({ periods, transactionTime: new Date('2025-06-14T00:00:00Z'), frequency: weekly }),
    ).toBeNull();
  });

  it('returns null without periods', () => {
    expect(pickNearestOpenPeriod({ periods: [], transactionTime: new Date(), frequency: monthly })).toBeNull();
  });
});

describe('pickNearestOpenPeriod with a custom frequency', () => {
  const every30Days = {
    frequency: SUBSCRIPTION_FREQUENCIES.custom,
    intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
    intervalCount: 30,
  };

  it('settles within 15 days of the due date and not 16', () => {
    const periods = [{ id: 'a', dueDate: '2025-06-30' }];
    expect(
      pickNearestOpenPeriod({ periods, transactionTime: new Date('2025-06-15T00:00:00Z'), ...every30Days })?.id,
    ).toBe('a');
    expect(pickNearestOpenPeriod({ periods, transactionTime: new Date('2025-06-14T00:00:00Z'), ...every30Days })).toBe(
      null,
    );
  });
});
