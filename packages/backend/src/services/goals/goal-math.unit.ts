import {
  FULL_SHARE,
  accountGoalValue,
  computeGoalProgress,
  etaDate,
  etaMonths,
  goalDisplayStatus,
  goalMonthlyDemand,
  isWithinReachedHold,
  median,
  neededMonthly,
  roundShare,
  scheduleOffset,
  toGoalCurrency,
} from '@bt/shared/goals/goal-math';
import type { GoalAccountHistory, GoalMathInput, RecordId } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

const id = (value: string) => value as RecordId;

const TODAY = '2026-10-20';
// Index 5 is March, 11 is September (the last full month), 12 is today.
const MONTHS = [
  '2025-10-31',
  '2025-11-30',
  '2025-12-31',
  '2026-01-31',
  '2026-02-28',
  '2026-03-31',
  '2026-04-30',
  '2026-05-31',
  '2026-06-30',
  '2026-07-31',
  '2026-08-31',
  '2026-09-30',
  TODAY,
];

const account = ({
  monthEndBalances,
  currentBalance = monthEndBalances[monthEndBalances.length - 1]!,
  sharePercent = 100,
  fixedAmount = null,
  fixedAhead = 0,
  fixedOthers = 0,
  creditLimit = 0,
  firstDataDate = '2025-01-01',
  accountId = id('a'),
}: Partial<GoalAccountHistory> & { monthEndBalances: number[] }): GoalAccountHistory => ({
  accountId,
  sharePercent: fixedAmount === null ? sharePercent : null,
  fixedAmount,
  fixedAhead,
  fixedOthers,
  currentBalance,
  creditLimit,
  firstDataDate,
  monthEndBalances,
});

/** +100 every month: 0, 100, …, 1200 today. */
const steady = (overrides: Partial<GoalAccountHistory> = {}) =>
  account({ monthEndBalances: MONTHS.map((_, index) => index * 100), ...overrides });

const progress = (input: Partial<GoalMathInput>) =>
  computeGoalProgress({
    today: TODAY,
    months: MONTHS,
    accounts: [steady()],
    targetAmount: 2400,
    targetDate: null,
    plannedMonthly: null,
    ...input,
  });

const inDays = (days: number) => new Date(Date.parse(TODAY) + days * 86_400_000).toISOString().slice(0, 10);

describe('computeGoalProgress', () => {
  it('derives current value, pace and ETA from a steady history', () => {
    expect(progress({})).toMatchObject({
      status: 'no_date',
      currentValue: 1200,
      remaining: 1200,
      historicalPace: 100,
      historyMonths: 6,
      pace: 100,
      etaMonths: 12,
      neededMonthly: null,
      daysLeft: null,
      monthsLeft: null,
    });
  });

  it('reports no_accounts when nothing backs the goal', () => {
    expect(progress({ accounts: [] })).toMatchObject({ status: 'no_accounts', currentValue: 0, remaining: 2400 });
  });

  it('reports reached once the value covers the target, whatever the date', () => {
    expect(progress({ targetAmount: 1000, targetDate: inDays(-10) })).toMatchObject({
      status: 'reached',
      remaining: 0,
      etaMonths: 0,
      neededMonthly: 0,
    });
  });

  it('reports overdue past the date, with the whole remainder needed', () => {
    expect(progress({ targetDate: inDays(-1) })).toMatchObject({
      status: 'overdue',
      daysLeft: -1,
      monthsLeft: -1,
      neededMonthly: 1200,
    });
  });

  it('reports behind, not overdue, on the target date itself, with the whole remainder needed', () => {
    expect(progress({ targetDate: TODAY })).toMatchObject({
      status: 'behind',
      daysLeft: 0,
      monthsLeft: 0,
      neededMonthly: 1200,
    });
  });

  it('reports ahead when the target lands at least a month before the date', () => {
    expect(progress({ targetDate: inDays(730) }).status).toBe('ahead');
  });

  it('reports on_track when the target lands within the last month before the date', () => {
    // 380 days is 12 whole months; 12 months to go at the pace.
    expect(progress({ targetDate: inDays(380) }).status).toBe('on_track');
  });

  it('reports behind when the pace misses the date', () => {
    expect(progress({ targetDate: inDays(180) }).status).toBe('behind');
  });

  it('judges the status by the displayed whole-month ETA', () => {
    // 11.5 months to go shows as 12; 359 days is 11 whole months.
    expect(progress({ targetAmount: 2350, targetDate: inDays(359) })).toMatchObject({
      status: 'behind',
      etaMonths: 12,
    });
  });

  it('counts calendar months, not average-length ones, when judging the offset', () => {
    // 608 days is 19.97 average months, but 2026-11-01 to 2028-07-01 is exactly 20 calendar months.
    const result = progress({ today: '2026-11-01', targetDate: '2028-07-01', targetAmount: 3400, plannedMonthly: 100 });

    expect(result).toMatchObject({ status: 'behind', daysLeft: 608, monthsLeft: 20, etaMonths: 22 });
    expect(scheduleOffset({ etaMonths: result.etaMonths!, monthsLeft: result.monthsLeft! })).toEqual({
      kind: 'late',
      months: 2,
    });
  });

  it('steps monthsLeft like etaDate, including the end-of-month clamp', () => {
    expect(progress({ today: '2026-01-31', targetDate: '2026-02-28' }).monthsLeft).toBe(1);
    expect(progress({ today: '2026-01-31', targetDate: '2026-02-27' }).monthsLeft).toBe(0);
    expect(progress({ today: '2027-01-31', targetDate: '2028-02-29' }).monthsLeft).toBe(13);
    expect(progress({ today: '2027-01-31', targetDate: '2028-02-28' }).monthsLeft).toBe(12);
    expect(progress({ today: '2028-02-29', targetDate: '2029-02-28' }).monthsLeft).toBe(12);
    expect(progress({ today: '2028-02-29', targetDate: '2029-02-27' }).monthsLeft).toBe(11);
  });

  it('is overdue with negative monthsLeft across a year boundary', () => {
    expect(progress({ today: '2026-01-10', targetDate: '2025-12-05' })).toMatchObject({
      status: 'overdue',
      monthsLeft: -2,
    });
  });

  it('flips the status on the exact calendar day', () => {
    expect(progress({ targetAmount: 2300, plannedMonthly: 100, targetDate: '2027-10-20' }).status).toBe('ahead');
    expect(progress({ targetAmount: 2400, plannedMonthly: 100, targetDate: '2027-10-20' }).status).toBe('on_track');
    expect(progress({ targetAmount: 2400, plannedMonthly: 100, targetDate: '2027-10-19' }).status).toBe('behind');
  });

  it('reports behind when the balance is not growing', () => {
    const flat = account({ monthEndBalances: MONTHS.map(() => 500) });
    expect(progress({ accounts: [flat], targetDate: inDays(730) })).toMatchObject({
      status: 'behind',
      historicalPace: 0,
      etaMonths: null,
    });
  });

  it('reports insufficient_history for a dated goal with under three full months', () => {
    const young = steady({ firstDataDate: '2026-07-15' });
    expect(progress({ accounts: [young], targetDate: inDays(730) })).toMatchObject({
      status: 'insufficient_history',
      historicalPace: null,
      historyMonths: 2,
      pace: null,
      etaMonths: null,
    });
  });

  it('accepts exactly three full months of history', () => {
    const young = steady({ firstDataDate: '2026-06-20' });
    expect(progress({ accounts: [young] })).toMatchObject({ historicalPace: 100, historyMonths: 3 });
  });

  it('starts the window at the latest first-data date, skipping carried-back flat months', () => {
    // Opened in June at 1000: the months before it are the opening balance carried back.
    const opened = account({
      monthEndBalances: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1300, 1600, 1900, 2000],
      firstDataDate: '2026-06-10',
    });
    expect(progress({ accounts: [opened] })).toMatchObject({ historicalPace: 300, historyMonths: 3 });

    // The older account alone has six months, but the younger one bounds the window.
    expect(
      progress({ accounts: [steady({ accountId: id('old') }), { ...opened, accountId: id('new') }] }),
    ).toMatchObject({
      historyMonths: 3,
      historicalPace: 400,
    });
  });

  it('lets plannedMonthly replace the pace, even without history', () => {
    const young = steady({ firstDataDate: '2026-09-01' });
    expect(progress({ accounts: [young], plannedMonthly: 300, targetDate: inDays(730) })).toMatchObject({
      status: 'ahead',
      historicalPace: null,
      pace: 300,
      etaMonths: 4,
    });
  });

  it('applies the share to the balance', () => {
    expect(progress({ accounts: [steady({ sharePercent: 25 })] })).toMatchObject({
      currentValue: 300,
      historicalPace: 25,
      monthEndValues: MONTHS.map((_, index) => index * 25),
    });
  });

  it('clamps a negative balance at zero instead of reducing progress', () => {
    const overdrawn = account({ accountId: id('b'), monthEndBalances: MONTHS.map(() => -500) });
    expect(progress({ accounts: [steady(), overdrawn] })).toMatchObject({
      currentValue: 1200,
      monthEndValues: MONTHS.map((_, index) => index * 100),
    });
  });

  it('subtracts the credit limit before the share, on every point', () => {
    const withLimit = account({ monthEndBalances: MONTHS.map(() => 1500), creditLimit: 1000, sharePercent: 50 });
    expect(progress({ accounts: [withLimit] })).toMatchObject({
      currentValue: 250,
      monthEndValues: MONTHS.map(() => 250),
    });

    const underLimit = account({ monthEndBalances: MONTHS.map(() => 800), creditLimit: 1000 });
    expect(progress({ accounts: [underLimit] }).currentValue).toBe(0);
  });
});

describe('neededMonthly', () => {
  it('divides by days left at day precision', () => {
    // 45 days = 1.478 months.
    expect(neededMonthly({ remaining: 1000, today: TODAY, targetDate: inDays(45) })).toEqual({
      neededMonthly: 676.44,
      daysLeft: 45,
    });
  });

  it('moves smoothly across a month boundary', () => {
    const before = neededMonthly({ remaining: 1000, today: TODAY, targetDate: inDays(62) }).neededMonthly!;
    const after = neededMonthly({ remaining: 1000, today: TODAY, targetDate: inDays(61) }).neededMonthly!;
    expect(after - before).toBeLessThan(10);
  });

  it('asks for the whole remainder under one month left', () => {
    expect(neededMonthly({ remaining: 1000, today: TODAY, targetDate: inDays(20) })).toEqual({
      neededMonthly: 1000,
      daysLeft: 20,
    });
  });
});

describe('etaMonths', () => {
  it('rounds whole months up without float noise', () => {
    expect(etaMonths({ remaining: 11, pace: 1 })).toBe(11);
    expect(etaMonths({ remaining: 1.1, pace: 0.1 })).toBe(11);
    expect(etaMonths({ remaining: 1201, pace: 100 })).toBe(13);
  });
});

describe('median', () => {
  it('averages the two middle values of an even list', () => {
    expect(median({ values: [300, 100, 200, 400] })).toBe(250);
    expect(median({ values: [] })).toBeNull();
  });
});

describe('toGoalCurrency', () => {
  it('converts to cents and passes null through', () => {
    expect(toGoalCurrency({ amount: 100, rateToBase: 3 })).toBe(33.33);
    expect(toGoalCurrency({ amount: 2203.5, rateToBase: 3.6725 })).toBe(600);
    expect(toGoalCurrency({ amount: null, rateToBase: 3 })).toBeNull();
  });
});

const accountValue = (params: Partial<Parameters<typeof accountGoalValue>[0]> & { balance: number }) =>
  accountGoalValue({
    creditLimit: 0,
    sharePercent: null,
    fixedAmount: null,
    fixedAhead: 0,
    fixedOthers: 0,
    ...params,
  });

describe('accountGoalValue', () => {
  it('applies the share to the balance above the credit limit, never below 0', () => {
    expect(accountValue({ balance: 1500, creditLimit: 1000, sharePercent: 50 })).toBe(250);
    expect(accountValue({ balance: 500, creditLimit: 1000, sharePercent: 50 })).toBe(0);
    expect(accountValue({ balance: 0.1, sharePercent: 33.33 })).toBe(0.03);
  });

  it('gives a fixed amount what the fixed amounts ahead of it leave, up to itself', () => {
    expect(accountValue({ balance: 150_000, fixedAmount: 100_000 })).toBe(100_000);
    expect(accountValue({ balance: 60_000, fixedAmount: 100_000 })).toBe(60_000);
    expect(accountValue({ balance: 120_000, fixedAmount: 50_000, fixedAhead: 100_000 })).toBe(20_000);
    expect(accountValue({ balance: 90_000, fixedAmount: 50_000, fixedAhead: 100_000 })).toBe(0);
    expect(accountValue({ balance: 1500, creditLimit: 1000, fixedAmount: 400 })).toBe(400);
  });

  it('splits only what all fixed amounts leave between the shares', () => {
    expect(accountValue({ balance: 150_000, sharePercent: 50, fixedOthers: 100_000 })).toBe(25_000);
    expect(accountValue({ balance: 120_000, sharePercent: 10, fixedOthers: 150_000 })).toBe(0);
  });
});

describe('scheduleOffset', () => {
  it('agrees with the progress status on whole months', () => {
    expect(scheduleOffset({ etaMonths: 10, monthsLeft: 12 })).toEqual({ kind: 'early', months: 2 });
    expect(scheduleOffset({ etaMonths: 11, monthsLeft: 12 })).toEqual({ kind: 'early', months: 1 });
    expect(scheduleOffset({ etaMonths: 12, monthsLeft: 12 })).toEqual({ kind: 'onTime', months: 0 });
    expect(scheduleOffset({ etaMonths: 12, monthsLeft: 5 })).toEqual({ kind: 'late', months: 7 });
    expect(scheduleOffset({ etaMonths: 6, monthsLeft: 5 })).toEqual({ kind: 'late', months: 1 });

    expect(progress({ targetDate: inDays(380) }).status).toBe('on_track');
    expect(progress({ targetDate: inDays(180) }).status).toBe('behind');
  });
});

describe('etaDate', () => {
  it('adds whole months and clamps to the month end', () => {
    expect(etaDate({ today: TODAY, etaMonths: 0 })).toBe(TODAY);
    expect(etaDate({ today: TODAY, etaMonths: 3 })).toBe('2027-01-20');
    expect(etaDate({ today: '2026-01-31', etaMonths: 1 })).toBe('2026-02-28');
  });
});

describe('goalDisplayStatus', () => {
  const insights = { status: 'behind' as const };

  const now = new Date('2026-10-20T12:00:00Z');
  const display = (params: Omit<Parameters<typeof goalDisplayStatus>[0], 'reachedHoldDays' | 'now'>) =>
    goalDisplayStatus({ reachedHoldDays: 30, now, ...params });

  it('ranks archived, the latch, a missing rate and pause over the progress status', () => {
    expect(display({ status: 'archived', achievedAt: '2026-10-01', insights })).toBe('archived');
    expect(display({ status: 'active', achievedAt: '2026-10-01', insights })).toBe('reached');
    expect(display({ status: 'active', achievedAt: null, insights: null })).toBe('no_rate');
    expect(display({ status: 'paused', achievedAt: null, insights: { status: 'reached' } })).toBe('reached');
    expect(display({ status: 'paused', achievedAt: null, insights })).toBe('paused');
    expect(display({ status: 'active', achievedAt: null, insights })).toBe('behind');
  });

  it('keeps a dipped goal reached only within its hold window', () => {
    const achievedAt = '2026-10-10T12:00:00Z';
    expect(goalDisplayStatus({ status: 'active', achievedAt, reachedHoldDays: 30, insights, now })).toBe('reached');
    expect(goalDisplayStatus({ status: 'active', achievedAt, reachedHoldDays: 7, insights, now })).toBe('behind');
    expect(goalDisplayStatus({ status: 'active', achievedAt, reachedHoldDays: 0, insights, now })).toBe('behind');
    expect(
      goalDisplayStatus({ status: 'active', achievedAt, reachedHoldDays: 0, insights: { status: 'reached' }, now }),
    ).toBe('reached');
  });
});

const demand = ({ daysLeft }: { daysLeft: number | null }) =>
  goalMonthlyDemand({ daysLeft, neededMonthly: 300, input: { plannedMonthly: 500 } });

describe('isWithinReachedHold', () => {
  it('ends the hold exactly reachedHoldDays after achievedAt', () => {
    const achievedAt = '2026-10-10T12:00:00.000Z';
    const at = (iso: string) => isWithinReachedHold({ achievedAt, reachedHoldDays: 10, now: new Date(iso) });

    expect(at('2026-10-20T11:59:59.999Z')).toBe(true);
    expect(at('2026-10-20T12:00:00.000Z')).toBe(false);
    expect(isWithinReachedHold({ achievedAt, reachedHoldDays: 0, now: new Date(achievedAt) })).toBe(false);
  });
});

describe('goalMonthlyDemand', () => {
  it('takes the larger of the need and the plan', () => {
    expect(demand({ daysLeft: null })).toBe(500);
    expect(demand({ daysLeft: 90 })).toBe(500);
    expect(goalMonthlyDemand({ daysLeft: 90, neededMonthly: 700, input: { plannedMonthly: null } })).toBe(700);
  });

  it('is null when the date is under a month away or past', () => {
    expect(demand({ daysLeft: 20 })).toBeNull();
    expect(demand({ daysLeft: -5 })).toBeNull();
  });
});

describe('shares', () => {
  it('rounds to two decimals against a 100% whole', () => {
    expect(FULL_SHARE).toBe(100);
    expect(roundShare(33.333)).toBe(33.33);
    expect(roundShare(33.336)).toBe(33.34);
  });
});
