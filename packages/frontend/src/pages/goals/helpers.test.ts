import type { GoalInsights, GoalModel, RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  GOAL_DISPLAY_TONES,
  getAccountShareCapacity,
  getGoalDisplayKind,
  getGoalProgress,
  getGoalSection,
  getGoalStatusLabel,
  getScheduleOffset,
  isGoalBehind,
  splitGoalSections,
  toGoalCurrency,
} from './helpers';

const id = (value: string) => value as RecordId;

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

const buildGoal = (overrides: Partial<GoalModel> = {}): GoalModel => ({
  id: id('goal-1'),
  name: 'Car',
  currencyCode: 'USD',
  targetAmount: 1000,
  targetDate: null,
  plannedMonthly: null,
  status: 'active',
  achievedAt: null,
  achievedAmount: null,
  sortOrder: 0,
  accounts: [],
  insights: buildInsights(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  ...overrides,
});

describe('getGoalSection / splitGoalSections', () => {
  it('puts archived goals in archived, whatever their progress', () => {
    expect(getGoalSection({ goal: buildGoal({ status: 'archived', achievedAt: '2026-03-14T00:00:00Z' }) })).toBe(
      'archived',
    );
  });

  it('ends a goal once it was achieved, even if the balance dropped since', () => {
    expect(getGoalSection({ goal: buildGoal({ achievedAt: '2026-03-14T00:00:00Z' }) })).toBe('ended');
  });

  it('ends a goal the server reports as reached before the latch runs', () => {
    expect(getGoalSection({ goal: buildGoal({ insights: buildInsights({ status: 'reached' }) }) })).toBe('ended');
  });

  it('keeps active and paused goals active, including ones without a rate', () => {
    expect(getGoalSection({ goal: buildGoal({ status: 'paused' }) })).toBe('active');
    expect(getGoalSection({ goal: buildGoal({ insights: null }) })).toBe('active');
  });

  it('splits a list preserving order', () => {
    const goals = [
      buildGoal({ id: id('a') }),
      buildGoal({ id: id('b'), status: 'archived' }),
      buildGoal({ id: id('c'), achievedAt: '2026-03-14T00:00:00Z' }),
      buildGoal({ id: id('d'), status: 'paused' }),
    ];
    const sections = splitGoalSections({ goals });
    expect(sections.active.map((goal) => goal.id)).toEqual(['a', 'd']);
    expect(sections.ended.map((goal) => goal.id)).toEqual(['c']);
    expect(sections.archived.map((goal) => goal.id)).toEqual(['b']);
  });
});

describe('toGoalCurrency / getGoalProgress', () => {
  it('divides a base amount by the rate, rounded to cents', () => {
    expect(toGoalCurrency({ amount: 4100, insights: { rateToBase: 41 } })).toBe(100);
    expect(toGoalCurrency({ amount: 100, insights: { rateToBase: 3 } })).toBe(33.33);
  });

  it('passes a missing amount or rate through as null', () => {
    expect(toGoalCurrency({ amount: null, insights: { rateToBase: 41 } })).toBeNull();
    expect(toGoalCurrency({ amount: 4100, insights: null })).toBeNull();
  });

  it('returns null without insights', () => {
    expect(getGoalProgress({ goal: buildGoal({ insights: null }) })).toBeNull();
  });

  it('reports saved in the goal currency and a floored percent', () => {
    const goal = buildGoal({ targetAmount: 600, insights: buildInsights({ currentValue: 16_400, rateToBase: 41 }) });
    expect(getGoalProgress({ goal })).toEqual({ saved: 400, percent: 66 });
  });

  it('stays under 100% until reached and shows overfunding once reached', () => {
    const almost = buildGoal({ targetAmount: 100, insights: buildInsights({ currentValue: 100, status: 'on_track' }) });
    expect(getGoalProgress({ goal: almost })?.percent).toBe(99);

    const over = buildGoal({ targetAmount: 100, insights: buildInsights({ currentValue: 104, status: 'reached' }) });
    expect(getGoalProgress({ goal: over })?.percent).toBe(104);
  });
});

describe('getGoalDisplayKind / tones', () => {
  it.each([
    [{ status: 'archived' as const }, 'archived'],
    [{ insights: null }, 'no_rate'],
    [{ status: 'paused' as const, insights: buildInsights({ status: 'reached' }) }, 'reached'],
    [{ status: 'paused' as const }, 'paused'],
    [{ insights: buildInsights({ status: 'behind' }) }, 'behind'],
    [{ achievedAt: '2026-03-14T00:00:00Z', insights: buildInsights({ status: 'behind' }) }, 'reached'],
  ])('maps %o to %s', (overrides, kind) => {
    expect(getGoalDisplayKind({ goal: buildGoal(overrides) })).toBe(kind);
  });

  it('has a tone for every kind', () => {
    expect(GOAL_DISPLAY_TONES.behind.textClass).toBe('text-warning-text');
    expect(GOAL_DISPLAY_TONES.on_track.pillClass).toContain('text-success-text');
    expect(GOAL_DISPLAY_TONES.no_date.barClass).toBe('bg-primary');
  });

  it('treats behind and overdue as behind', () => {
    expect(isGoalBehind({ goal: buildGoal({ insights: buildInsights({ status: 'overdue' }) }) })).toBe(true);
    expect(isGoalBehind({ goal: buildGoal({ insights: buildInsights({ status: 'behind' }) }) })).toBe(true);
    expect(isGoalBehind({ goal: buildGoal({ status: 'paused', insights: buildInsights({ status: 'behind' }) }) })).toBe(
      false,
    );
  });

  it('does not count a reached goal that dipped below target as behind', () => {
    const goal = buildGoal({ achievedAt: '2026-03-14T00:00:00Z', insights: buildInsights({ status: 'behind' }) });
    expect(isGoalBehind({ goal })).toBe(false);
  });
});

describe('getGoalStatusLabel', () => {
  it('counts the months a behind goal runs late', () => {
    expect(getGoalStatusLabel({ status: 'behind', progress: { etaMonths: 30, daysLeft: 305 } })).toEqual({
      key: 'goals.status.behindBy',
      count: 20,
    });
  });

  it('falls back to a plain behind label without an ETA', () => {
    expect(getGoalStatusLabel({ status: 'behind', progress: { etaMonths: null, daysLeft: 304 } })).toEqual({
      key: 'goals.status.behind',
    });
  });

  it('projects an undated goal from the server today', () => {
    expect(
      getGoalStatusLabel({ status: 'no_date', progress: { etaMonths: 10, daysLeft: null }, today: '2026-10-20' }),
    ).toEqual({ key: 'goals.status.around', date: '2027-08-20' });
  });

  it('uses the plain key for the rest', () => {
    expect(getGoalStatusLabel({ status: 'on_track', progress: buildInsights() })).toEqual({
      key: 'goals.status.onTrack',
    });
    expect(getGoalStatusLabel({ status: 'no_rate', progress: null })).toEqual({ key: 'goals.status.noRate' });
  });
});

describe('getScheduleOffset', () => {
  const daysLeft = 305;

  it('counts whole months early when ahead', () => {
    expect(getScheduleOffset({ progress: { status: 'ahead', etaMonths: 6, daysLeft } })).toEqual({
      kind: 'early',
      months: 4,
    });
  });

  it('is on time within the last month', () => {
    expect(getScheduleOffset({ progress: { status: 'on_track', etaMonths: 10, daysLeft } })).toEqual({
      kind: 'onTime',
      months: 0,
    });
  });

  it('counts months late when behind', () => {
    expect(getScheduleOffset({ progress: { status: 'behind', etaMonths: 13, daysLeft } })).toEqual({
      kind: 'late',
      months: 3,
    });
  });

  it('is null without an ETA, a date, or a dated status', () => {
    expect(getScheduleOffset({ progress: { status: 'behind', etaMonths: null, daysLeft } })).toBeNull();
    expect(getScheduleOffset({ progress: { status: 'no_date', etaMonths: 4, daysLeft: null } })).toBeNull();
    expect(getScheduleOffset({ progress: { status: 'reached', etaMonths: 0, daysLeft } })).toBeNull();
  });
});

describe('getAccountShareCapacity', () => {
  const accountId = id('acc-1');
  const goals = [
    buildGoal({ id: id('a'), name: 'Car', accounts: [{ accountId, sharePercent: 25.5 }] }),
    buildGoal({ id: id('b'), name: 'Laptop', status: 'paused', accounts: [{ accountId, sharePercent: 30.25 }] }),
    buildGoal({ id: id('c'), status: 'archived', accounts: [{ accountId, sharePercent: 40 }] }),
    buildGoal({ id: id('d'), accounts: [{ accountId: id('acc-2'), sharePercent: 100 }] }),
  ];

  it('subtracts active and paused claims only and lists their holders', () => {
    expect(getAccountShareCapacity({ goals, accountId })).toEqual({
      free: 44.25,
      max: 44.25,
      holders: [
        { name: 'Car', sharePercent: 25.5 },
        { name: 'Laptop', sharePercent: 30.25 },
      ],
    });
  });

  it('leaves out the goal being edited', () => {
    const capacity = getAccountShareCapacity({ goals, accountId, editingGoal: goals[0] });
    expect(capacity.free).toBe(69.75);
    expect(capacity.holders).toEqual([{ name: 'Laptop', sharePercent: 30.25 }]);
  });

  it('lets an archived goal take the whole account', () => {
    const capacity = getAccountShareCapacity({ goals, accountId: id('acc-2'), editingGoal: goals[2] });
    expect(capacity).toMatchObject({ free: 0, max: 100 });
  });

  it('never goes below zero', () => {
    const full = [
      buildGoal({ id: id('x'), accounts: [{ accountId, sharePercent: 33.33 }] }),
      buildGoal({ id: id('y'), accounts: [{ accountId, sharePercent: 33.33 }] }),
      buildGoal({ id: id('z'), accounts: [{ accountId, sharePercent: 33.34 }] }),
    ];
    expect(getAccountShareCapacity({ goals: full, accountId }).free).toBe(0);
    expect(getAccountShareCapacity({ goals: [], accountId }).max).toBe(100);
  });
});
