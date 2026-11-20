import type { GoalInsights } from '@bt/shared/types';

export const buildInsights = (overrides: Partial<GoalInsights> = {}): GoalInsights => ({
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
  monthsLeft: null,
  input: {
    today: '2026-10-20',
    months: [],
    accounts: [],
    targetAmount: 0,
    targetDate: null,
    plannedMonthly: null,
    decimals: 2,
  },
  rateToBase: 1,
  goalDecimals: 2,
  baseCurrencyCode: 'USD',
  ...overrides,
});
