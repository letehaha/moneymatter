import type { AccountModel, GoalAccountHistory, GoalInsights, RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  MAX_PROJECTION_MONTHS,
  formatRowAmount,
  getAccountBreakdown,
  getGoalHistory,
  getGoalNeed,
  getHistorySummary,
  getPaceValueClass,
  getProjection,
} from './detail-helpers';

const id = (value: string) => value as RecordId;

const buildHistory = (overrides: Partial<GoalAccountHistory> = {}): GoalAccountHistory => ({
  accountId: id('a'),
  sharePercent: 100,
  currentBalance: 0,
  creditLimit: 0,
  firstDataDate: null,
  monthEndBalances: [],
  ...overrides,
});

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
  baseCurrencyCode: 'USD',
  ...overrides,
});

describe('getAccountBreakdown', () => {
  it('counts the share of balance minus credit limit, in the goal currency, biggest first', () => {
    const insights = buildInsights({
      currentValue: 800,
      rateToBase: 2,
      input: {
        ...buildInsights().input,
        accounts: [
          buildHistory({ accountId: id('a'), sharePercent: 25, currentBalance: 1200, creditLimit: 400 }),
          buildHistory({ accountId: id('b'), sharePercent: 100, currentBalance: 600 }),
        ],
      },
    });

    const rows = getAccountBreakdown({
      accounts: [
        { accountId: id('a'), sharePercent: 25 },
        { accountId: id('b'), sharePercent: 100 },
      ],
      insights,
    });

    expect(rows.map((row) => row.accountId)).toEqual([id('b'), id('a')]);
    expect(rows[0]).toMatchObject({ balance: 300, counted: 300, percentOfSaved: 75 });
    expect(rows[1]).toMatchObject({ balance: 600, counted: 100, percentOfSaved: 25 });
  });

  it('never counts a negative balance', () => {
    const insights = buildInsights({
      input: { ...buildInsights().input, accounts: [buildHistory({ currentBalance: -50 })] },
    });
    expect(getAccountBreakdown({ accounts: [{ accountId: id('a'), sharePercent: 100 }], insights })[0]!.counted).toBe(
      0,
    );
  });

  it('puts the cent rounding on the biggest row so rows add up to the saved amount', () => {
    const insights = buildInsights({
      currentValue: 0.02,
      rateToBase: 3,
      input: {
        ...buildInsights().input,
        accounts: [
          buildHistory({ accountId: id('a'), currentBalance: 0.01 }),
          buildHistory({ accountId: id('b'), currentBalance: 0.01 }),
        ],
      },
    });
    const rows = getAccountBreakdown({
      accounts: [
        { accountId: id('a'), sharePercent: 100 },
        { accountId: id('b'), sharePercent: 100 },
      ],
      insights,
    });
    expect(rows.map((row) => row.counted)).toEqual([0.01, 0]);
  });

  it('keeps a linked account without history as a row with no amounts', () => {
    const insights = buildInsights({ input: { ...buildInsights().input, accounts: [] } });
    expect(getAccountBreakdown({ accounts: [{ accountId: id('a'), sharePercent: 40 }], insights })).toEqual([
      { accountId: id('a'), sharePercent: 40, balance: null, counted: null, percentOfSaved: null },
    ]);
  });

  it('keeps shares but drops amounts without insights', () => {
    expect(getAccountBreakdown({ accounts: [{ accountId: id('a'), sharePercent: 40 }], insights: null })).toEqual([
      { accountId: id('a'), sharePercent: 40, balance: null, counted: null, percentOfSaved: null },
    ]);
  });
});

describe('getGoalHistory / getHistorySummary', () => {
  const insights = buildInsights({
    rateToBase: 2,
    monthEndValues: [200, 400, 300, 700],
    input: { ...buildInsights().input, months: ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-20'] },
  });

  it('converts month-end values and computes the change per month', () => {
    expect(getGoalHistory({ insights }).map(({ value, change }) => ({ value, change }))).toEqual([
      { value: 100, change: null },
      { value: 200, change: 100 },
      { value: 150, change: -50 },
      { value: 350, change: 200 },
    ]);
  });

  it('sums the gain and picks the best month', () => {
    const summary = getHistorySummary({ history: getGoalHistory({ insights }) })!;
    expect(summary.gain).toBe(250);
    expect(summary.gainPercent).toBe(250);
    expect(summary.best?.change).toBe(200);
    expect(summary.bestShareOfGain).toBe(80);
  });

  it('returns null below two points and no best month without growth', () => {
    expect(getHistorySummary({ history: [] })).toBeNull();
    const flat = getHistorySummary({
      history: [
        { date: new Date(), value: 5, change: null },
        { date: new Date(), value: 0, change: -5 },
      ],
    })!;
    expect(flat.best).toBeNull();
    expect(flat.bestShareOfGain).toBeNull();
  });
});

describe('formatRowAmount', () => {
  const account = (currencyCode: string) => ({ currencyCode }) as AccountModel;

  it('marks amounts converted from another currency', () => {
    expect(formatRowAmount({ row: { account: account('EUR') }, formatted: '$5', currencyCode: 'USD' })).toBe('≈ $5');
    expect(formatRowAmount({ row: { account: account('USD') }, formatted: '$5', currencyCode: 'USD' })).toBe('$5');
    expect(formatRowAmount({ row: { account: null }, formatted: '$5', currencyCode: 'USD' })).toBe('$5');
  });
});

describe('getGoalNeed', () => {
  it('is monthly a month or more before the date', () => {
    expect(getGoalNeed({ insights: buildInsights({ neededMonthly: 200, daysLeft: 31, rateToBase: 2 }) })).toEqual({
      kind: 'monthly',
      amount: 100,
    });
  });

  it('is the whole remainder under a month before the date or after it', () => {
    expect(getGoalNeed({ insights: buildInsights({ neededMonthly: 500, daysLeft: 12 }) })).toEqual({
      kind: 'dueSoon',
      amount: 500,
      days: 12,
    });
    expect(getGoalNeed({ insights: buildInsights({ neededMonthly: 500, daysLeft: -3 }) })).toEqual({
      kind: 'overdue',
      amount: 500,
    });
  });

  it('is null without a target date', () => {
    expect(getGoalNeed({ insights: buildInsights() })).toBeNull();
  });
});

describe('getPaceValueClass', () => {
  it('reds a negative pace, even with no need', () => {
    expect(getPaceValueClass({ pace: -778, need: null })).toBe('text-destructive-text');
  });

  it('warns when a positive pace is below the monthly need', () => {
    expect(getPaceValueClass({ pace: 100, need: { kind: 'monthly', amount: 500 } })).toBe('text-warning-text');
  });

  it('stays neutral when the pace covers the need or is missing', () => {
    expect(getPaceValueClass({ pace: 600, need: { kind: 'monthly', amount: 500 } })).toBeUndefined();
    expect(getPaceValueClass({ pace: null, need: { kind: 'monthly', amount: 500 } })).toBeUndefined();
  });
});

describe('getProjection', () => {
  it('projects from the saved amount at pace until the ETA', () => {
    const points = getProjection({ insights: buildInsights({ currentValue: 100, pace: 50, etaMonths: 2 }) });
    expect(points.map((point) => point.value)).toEqual([100, 150, 200]);
  });

  it('caps a far ETA and skips reached or stalled goals', () => {
    expect(getProjection({ insights: buildInsights({ pace: 1, etaMonths: 500 }) })).toHaveLength(
      MAX_PROJECTION_MONTHS + 1,
    );
    expect(getProjection({ insights: buildInsights({ status: 'reached', pace: 10, etaMonths: 0 }) })).toEqual([]);
    expect(getProjection({ insights: buildInsights({ pace: -5 }) })).toEqual([]);
  });
});
