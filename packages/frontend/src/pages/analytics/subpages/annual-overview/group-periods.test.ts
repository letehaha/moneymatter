import { type CashFlowPeriodData, type RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { groupPeriods, snapToBuckets } from './group-periods';

const month = ({
  start,
  end,
  expenses,
  food = 0,
  foodIncome = 0,
}: {
  start: string;
  end: string;
  expenses: number;
  food?: number;
  foodIncome?: number;
}) =>
  ({
    periodStart: start,
    periodEnd: end,
    income: 0,
    expenses,
    netFlow: -expenses,
    categories:
      food || foodIncome
        ? [
            {
              categoryId: 'food' as RecordId,
              name: 'Food',
              color: '#f00',
              incomeAmount: foodIncome,
              expenseAmount: food,
            },
          ]
        : [],
  }) satisfies CashFlowPeriodData;

const PERIODS = [
  month({ start: '2025-11-01', end: '2025-11-30', expenses: 10, food: 4 }),
  month({ start: '2025-12-01', end: '2025-12-31', expenses: 20, food: 6 }),
  month({ start: '2026-01-01', end: '2026-01-31', expenses: 30 }),
  month({ start: '2026-04-01', end: '2026-04-30', expenses: 40, food: 1 }),
];

describe('groupPeriods', () => {
  it('returns months untouched', () => {
    expect(groupPeriods({ periods: PERIODS, granularity: 'monthly' })).toBe(PERIODS);
  });

  it('sums months into quarters, categories included', () => {
    const quarters = groupPeriods({ periods: PERIODS, granularity: 'quarterly' });
    expect(quarters.map((q) => [q.periodStart, q.periodEnd, q.expenses, q.netFlow])).toEqual([
      ['2025-11-01', '2025-12-31', 30, -30],
      ['2026-01-01', '2026-01-31', 30, -30],
      ['2026-04-01', '2026-04-30', 40, -40],
    ]);
    expect(quarters[0]!.categories).toEqual([expect.objectContaining({ categoryId: 'food', expenseAmount: 10 })]);
    expect(quarters[2]!.categories).toEqual([expect.objectContaining({ categoryId: 'food', expenseAmount: 1 })]);
  });

  it('sums months into years without mutating the input', () => {
    const years = groupPeriods({ periods: PERIODS, granularity: 'yearly' });
    expect(years.map((y) => [y.periodStart, y.expenses])).toEqual([
      ['2025-11-01', 30],
      ['2026-01-01', 70],
    ]);
    expect(PERIODS[0]!.expenses).toBe(10);
    expect(PERIODS[0]!.categories[0]!.expenseAmount).toBe(4);
  });

  it('sums a category missing from the first month of a quarter without mutating the input', () => {
    const periods = [
      month({ start: '2026-01-01', end: '2026-01-31', expenses: 10 }),
      month({ start: '2026-02-01', end: '2026-02-28', expenses: 20, food: 5 }),
      month({ start: '2026-03-01', end: '2026-03-31', expenses: 30, food: 3 }),
    ];
    const [quarter] = groupPeriods({ periods, granularity: 'quarterly' });
    expect(quarter!.categories).toEqual([expect.objectContaining({ categoryId: 'food', expenseAmount: 8 })]);
    expect(periods[0]!.categories).toEqual([]);
    expect(periods[1]!.categories[0]!.expenseAmount).toBe(5);
    expect(periods[2]!.categories[0]!.expenseAmount).toBe(3);
  });

  it('sums category income across the months of a bucket', () => {
    const periods = [
      month({ start: '2026-01-01', end: '2026-01-31', expenses: 0, foodIncome: 7 }),
      month({ start: '2026-02-01', end: '2026-02-28', expenses: 0, foodIncome: 2 }),
    ];
    const [quarter] = groupPeriods({ periods, granularity: 'quarterly' });
    expect(quarter!.categories).toEqual([expect.objectContaining({ categoryId: 'food', incomeAmount: 9 })]);
  });
});

describe('snapToBuckets', () => {
  const from = new Date(2025, 10, 15);
  const to = new Date(2026, 4, 10);

  it('widens to whole quarters', () => {
    expect(snapToBuckets({ from, to, granularity: 'quarterly' })).toEqual({
      from: new Date(2025, 9, 1),
      to: new Date(2026, 5, 30, 23, 59, 59, 999),
    });
  });

  it('widens to whole years', () => {
    expect(snapToBuckets({ from, to, granularity: 'yearly' })).toEqual({
      from: new Date(2025, 0, 1),
      to: new Date(2026, 11, 31, 23, 59, 59, 999),
    });
  });
});
