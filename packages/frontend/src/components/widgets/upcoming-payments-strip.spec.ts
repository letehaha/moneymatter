import type { SubscriptionListItem } from '@/api/subscriptions';
import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_INTERVAL_UNITS,
  SUBSCRIPTION_PERIOD_STATUSES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';

import { buildPaymentsStrip } from './upcoming-payments-strip';

const NOW = new Date(2026, 8, 29, 15, 0);

const sub = (overrides: Partial<SubscriptionListItem>) =>
  ({
    nextDueDate: '2026-10-05',
    expectedAmount: 100,
    expectedCurrencyCode: 'SEK',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    transactionType: TRANSACTION_TYPES.expense,
    ...overrides,
  }) as SubscriptionListItem;

const RATES: Record<string, number | null> = { USD: 10, XXX: null };
const toBase = ({ amount, currencyCode }: { amount: number; currencyCode: string | null }) => {
  const rate = RATES[currencyCode ?? ''];
  if (rate === undefined) return amount;
  return rate === null ? null : amount * rate;
};
const outflowIndexes = ({ days }: { days: { outflow: number }[] }) =>
  days.flatMap((day, index) => (day.outflow ? [index] : []));

const build = (subscriptions: SubscriptionListItem[]) => buildPaymentsStrip({ subscriptions, now: NOW, toBase });

describe('components/widgets/upcoming-payments-strip', () => {
  test('repeats a custom every-10-days payment across the window', () => {
    const { days, totalOutflow } = build([
      sub({
        nextDueDate: '2026-09-30',
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        intervalCount: 10,
      }),
    ]);
    expect(outflowIndexes({ days })).toEqual([1, 11, 21]);
    expect(totalOutflow).toBe(300);
  });

  test('projects a custom every-28-days payment 28 days on, not a calendar month', () => {
    const { days } = build([
      sub({
        nextDueDate: '2026-09-30',
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        intervalCount: 28,
      }),
    ]);
    // Sep 30 + 28 days is Oct 28, inside the window; a monthly schedule would land on Oct 30, past it.
    expect(outflowIndexes({ days })).toEqual([1, 29]);
  });

  test('repeats a weekly payment across the window', () => {
    const { days, totalOutflow } = build([
      sub({ nextDueDate: '2026-09-30', frequency: SUBSCRIPTION_FREQUENCIES.weekly }),
    ]);
    expect(outflowIndexes({ days })).toEqual([1, 8, 15, 22, 29]);
    expect(totalOutflow).toBe(500);
  });

  test('counts an overdue payment once, on today, and keeps its later occurrences', () => {
    const { days } = build([sub({ nextDueDate: '2026-09-10', frequency: SUBSCRIPTION_FREQUENCIES.weekly })]);
    expect(days[0]).toMatchObject({ outflow: 100, status: 'overdue' });
    expect(outflowIndexes({ days })).toEqual([0, 2, 9, 16, 23]);
  });

  test('flags payments due within 3 days and splits income from outflow', () => {
    const { days, totalOutflow } = build([
      sub({ nextDueDate: '2026-10-02' }),
      sub({ nextDueDate: '2026-10-10', transactionType: TRANSACTION_TYPES.income, expectedAmount: 5000 }),
    ]);
    expect(days[3]).toMatchObject({ outflow: 100, status: 'dueSoon' });
    expect(days[11]).toMatchObject({ inflow: 5000, outflow: 0, status: null });
    expect(totalOutflow).toBe(100);
  });

  test('converts to base currency and skips amounts that cannot be converted', () => {
    const { totalOutflow } = build([
      sub({ expectedCurrencyCode: 'USD', expectedAmount: 2 }),
      sub({ expectedCurrencyCode: 'XXX' }),
      sub({ expectedAmount: null }),
      sub({ nextDueDate: '2026-11-30' }),
    ]);
    expect(totalOutflow).toBe(20);
  });

  test('keeps month-end anchors instead of drifting after a short month', () => {
    const { days } = build([sub({ nextDueDate: '2026-01-31' })]);
    expect(outflowIndexes({ days })).toEqual([0, 1]);
  });

  test('overdue wins over due-soon on the same day in either order', () => {
    const overdue = sub({ nextDueDate: '2026-09-20' });
    const dueToday = sub({ nextDueDate: '2026-09-29' });
    for (const input of [
      [overdue, dueToday],
      [dueToday, overdue],
    ]) {
      expect(build(input).days[0]).toMatchObject({ outflow: 200, status: 'overdue' });
    }
  });

  test('flags a period stored as overdue even when its date is not past yet', () => {
    const { days } = build([
      sub({
        nextDueDate: '2026-10-10',
        currentPeriod: { id: 'p1', dueDate: '2026-10-10', status: SUBSCRIPTION_PERIOD_STATUSES.overdue },
      }),
    ]);
    expect(days[11]).toMatchObject({ outflow: 100, status: 'overdue' });
  });

  test('stops recurring after the end date', () => {
    const { days } = build([
      sub({ nextDueDate: '2026-09-30', frequency: SUBSCRIPTION_FREQUENCIES.weekly, endDate: '2026-10-09' }),
    ]);
    expect(outflowIndexes({ days })).toEqual([1, 8]);
  });

  test('ends the due-soon window after 3 days and the strip after 30', () => {
    const { days, totalOutflow } = build([
      sub({ nextDueDate: '2026-10-03' }),
      sub({ nextDueDate: '2026-10-29' }),
      sub({ nextDueDate: 'garbage' }),
    ]);
    expect(days[4]).toMatchObject({ outflow: 100, status: null });
    expect(totalOutflow).toBe(100);
  });
});
