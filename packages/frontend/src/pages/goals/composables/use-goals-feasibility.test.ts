import type { GoalInsights, GoalModel, RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { computeGoalsFeasibility } from './use-goals-feasibility';

const NOW = new Date(2026, 9, 20);
const WINDOW_MONTHS = [
  '2025-10',
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
];

const periodsFrom = ({ netFlows }: { netFlows: number[] }) =>
  netFlows.map((netFlow, i) => ({
    periodStart: `${WINDOW_MONTHS[WINDOW_MONTHS.length - netFlows.length + i]}-01`,
    income: Math.max(netFlow, 0) + 100,
    expenses: Math.max(-netFlow, 0) + 100,
    netFlow,
  }));

const buildInsights = (overrides: Partial<GoalInsights> = {}): GoalInsights => ({
  status: 'on_track',
  currentValue: 0,
  remaining: 0,
  monthEndValues: [],
  historicalPace: null,
  historyMonths: 0,
  pace: null,
  etaMonths: null,
  neededMonthly: null,
  daysLeft: null,
  input: { today: '2026-10-20', months: [], accounts: [], targetAmount: 0, targetDate: null, plannedMonthly: null },
  rateToBase: 1,
  baseCurrencyCode: 'UAH',
  ...overrides,
});

const buildGoal = ({
  id,
  insights,
  ...overrides
}: Partial<Omit<GoalModel, 'id' | 'insights'>> & {
  id: string;
  insights?: Partial<GoalInsights> | null;
}): GoalModel => ({
  id: id as RecordId,
  name: id,
  currencyCode: 'UAH',
  targetAmount: 1000,
  targetDate: '2027-01-01',
  plannedMonthly: null,
  status: 'active',
  achievedAt: null,
  achievedAmount: null,
  sortOrder: 0,
  accounts: [],
  insights: insights === null ? null : buildInsights(insights),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  ...overrides,
});

const planned = ({ amount, neededMonthly = null }: { amount: number; neededMonthly?: number | null }) => ({
  plannedMonthly: amount,
  insights: { neededMonthly, input: { ...buildInsights().input, plannedMonthly: amount } },
});

describe('computeGoalsFeasibility', () => {
  const fullYear = periodsFrom({ netFlows: [100, 900, 300, 300, 300, 300, 300, 300, 300, 300, 300, -500] });

  it('is null without active dated or planned goals', () => {
    const goals = [
      buildGoal({ id: 'undated', targetDate: null, insights: { neededMonthly: 50 } }),
      buildGoal({ id: 'paused', status: 'paused', insights: { neededMonthly: 50 } }),
      buildGoal({ id: 'archived', status: 'archived', insights: { neededMonthly: 50 } }),
      buildGoal({ id: 'reached', insights: { status: 'reached', neededMonthly: 0 } }),
      buildGoal({ id: 'no-rate', insights: null }),
    ];
    expect(computeGoalsFeasibility({ goals, periods: fullYear, now: NOW })).toBeNull();
  });

  it('reports insufficient history below the minimum months', () => {
    const goals = [buildGoal({ id: 'car', insights: { neededMonthly: 50 } })];
    const result = computeGoalsFeasibility({ goals, periods: periodsFrom({ netFlows: [300, 300] }), now: NOW });
    expect(result).toEqual({ state: 'insufficient_history', minMonths: 3 });
  });

  it('compares the sum of max(needed, planned) with the median net flow', () => {
    const goals = [
      buildGoal({ id: 'car', insights: { neededMonthly: 120 } }),
      buildGoal({ id: 'trip', ...planned({ amount: 80, neededMonthly: 50 }) }),
    ];
    const result = computeGoalsFeasibility({ goals, periods: fullYear, now: NOW });
    expect(result).toMatchObject({ state: 'ready', needed: 200, saving: 300, fits: true, baseCurrencyCode: 'UAH' });
  });

  it('funds goals nearest date first, undated planned goals last', () => {
    const goals = [
      buildGoal({ id: 'undated', targetDate: null, ...planned({ amount: 50 }) }),
      buildGoal({ id: 'late', targetDate: '2028-01-01', insights: { neededMonthly: 150 } }),
      buildGoal({ id: 'soon', targetDate: '2026-12-01', insights: { neededMonthly: 200 } }),
    ];
    const result = computeGoalsFeasibility({ goals, periods: fullYear, now: NOW });
    expect(result?.state).toBe('ready');
    if (result?.state !== 'ready') return;
    expect(result.items.map(({ goal, monthly, fits }) => [goal.id, monthly, fits])).toEqual([
      ['soon', 200, true],
      ['late', 150, false],
      ['undated', 50, false],
    ]);
    expect(result).toMatchObject({ needed: 400, saving: 300, fits: false });
  });

  it('sums the base-currency plan from insights, not the goal-currency plannedMonthly', () => {
    const goals = [
      buildGoal({
        id: 'usd',
        currencyCode: 'USD',
        plannedMonthly: 40,
        insights: { rateToBase: 2, neededMonthly: 60, input: { ...buildInsights().input, plannedMonthly: 80 } },
      }),
    ];
    const result = computeGoalsFeasibility({ goals, periods: fullYear, now: NOW });
    expect(result).toMatchObject({ state: 'ready', needed: 80, items: [{ monthly: 80 }] });
  });

  it('lists goals due within a month or overdue separately and leaves them out of the monthly sum', () => {
    const goals = [
      buildGoal({ id: 'overdue', targetDate: '2026-10-01', insights: { daysLeft: -19, neededMonthly: 900 } }),
      buildGoal({ id: 'soon', targetDate: '2026-10-30', insights: { daysLeft: 10, neededMonthly: 900 } }),
      buildGoal({ id: 'car', targetDate: '2027-10-20', insights: { daysLeft: 365, neededMonthly: 120 } }),
    ];
    const result = computeGoalsFeasibility({ goals, periods: fullYear, now: NOW });
    expect(result).toMatchObject({ state: 'ready', needed: 120, fits: true });
    if (result?.state !== 'ready') return;
    expect(result.items.map(({ goal }) => goal.id)).toEqual(['car']);
    expect(result.due.map(({ goal, daysLeft }) => [goal.id, daysLeft])).toEqual([
      ['overdue', -19],
      ['soon', 10],
    ]);
  });

  it('is null when every goal is due within a month', () => {
    const goals = [buildGoal({ id: 'soon', targetDate: '2026-10-30', insights: { daysLeft: 10, neededMonthly: 900 } })];
    expect(computeGoalsFeasibility({ goals, periods: fullYear, now: NOW })).toBeNull();
  });

  it('fits nothing that costs money when the median net flow is negative', () => {
    const goals = [buildGoal({ id: 'car', insights: { neededMonthly: 10 } })];
    const result = computeGoalsFeasibility({ goals, periods: periodsFrom({ netFlows: [-50, -20, 40] }), now: NOW });
    expect(result).toMatchObject({ state: 'ready', saving: -20, fits: false });
  });
});
