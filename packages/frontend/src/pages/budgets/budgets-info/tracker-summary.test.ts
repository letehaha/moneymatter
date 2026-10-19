import { describe, expect, it } from 'vitest';

import { getTrackerLimitSummary, getTrackerSpent } from './tracker-summary';

describe('getTrackerLimitSummary', () => {
  it('computes spent, left, rate and daily pace for an active tracker, counting today', () => {
    expect(
      getTrackerLimitSummary({
        limitAmount: 2000,
        summary: { balance: -1780, utilizationRate: 89 },
        timeStatus: { kind: 'active', daysLeft: 6 },
      }),
    ).toEqual({ spent: 1780, left: 220, rate: 89, dailyPace: 220 / 7 });
  });

  it('treats a positive balance as nothing spent', () => {
    const summary = getTrackerLimitSummary({
      limitAmount: 100,
      summary: { balance: 50, utilizationRate: 0 },
      timeStatus: { kind: 'noDates' },
    });
    expect(summary).toMatchObject({ spent: 0, left: 100, rate: 0, dailyPace: null });
  });

  it('returns a negative left and no pace when over the limit', () => {
    const summary = getTrackerLimitSummary({
      limitAmount: 1000,
      summary: { balance: -1040, utilizationRate: 104 },
      timeStatus: { kind: 'active', daysLeft: 3 },
    });
    expect(summary).toMatchObject({ left: -40, rate: 104, dailyPace: null });
  });

  it('puts everything left on the last day', () => {
    const summary = getTrackerLimitSummary({
      limitAmount: 100,
      summary: { balance: -40, utilizationRate: 40 },
      timeStatus: { kind: 'active', daysLeft: 0 },
    });
    expect(summary.dailyPace).toBe(60);
  });

  it('has no pace without an end date or outside the active period', () => {
    const base = { limitAmount: 100, summary: { balance: -40, utilizationRate: 40 } };
    expect(getTrackerLimitSummary({ ...base, timeStatus: { kind: 'active', daysLeft: null } }).dailyPace).toBeNull();
    expect(getTrackerLimitSummary({ ...base, timeStatus: { kind: 'ended', daysSinceEnd: 2 } }).dailyPace).toBeNull();
    expect(getTrackerLimitSummary({ ...base, timeStatus: { kind: 'upcoming', daysUntil: 2 } }).dailyPace).toBeNull();
  });
});

describe('getTrackerSpent', () => {
  it('measures net spend from the balance, never below zero', () => {
    expect(getTrackerSpent({ summary: { balance: -300 } })).toBe(300);
    expect(getTrackerSpent({ summary: { balance: 120 } })).toBe(0);
  });
});
