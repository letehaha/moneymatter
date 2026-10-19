import type { RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  getAveragePerDay,
  getCategorySplits,
  getCumulativeSeries,
  getPercent,
  getPeriodProgress,
  getTrackerPace,
} from './tracker-insights';

const now = new Date(2026, 2, 14, 12);

describe('getPeriodProgress', () => {
  it('counts elapsed days inclusively for an active tracker', () => {
    expect(getPeriodProgress({ startDate: new Date(2026, 2, 1), endDate: new Date(2026, 2, 20), now })).toEqual({
      start: new Date(2026, 2, 1),
      end: new Date(2026, 2, 20),
      totalDays: 20,
      elapsedDays: 14,
      isActive: true,
    });
  });

  it('treats ended trackers as fully elapsed', () => {
    expect(getPeriodProgress({ startDate: new Date(2026, 1, 1), endDate: new Date(2026, 1, 10), now })).toMatchObject({
      totalDays: 10,
      elapsedDays: 10,
      isActive: false,
    });
  });

  it('has no elapsed days before the start', () => {
    expect(getPeriodProgress({ startDate: new Date(2026, 3, 1), endDate: new Date(2026, 3, 30), now })).toMatchObject({
      totalDays: 30,
      elapsedDays: 0,
      isActive: false,
    });
  });

  it('counts the end day itself when the period ends today', () => {
    expect(getPeriodProgress({ startDate: '2026-03-01', endDate: '2026-03-14', now })).toMatchObject({
      totalDays: 14,
      elapsedDays: 14,
      isActive: true,
    });
  });

  it('returns null without both dates', () => {
    expect(getPeriodProgress({ startDate: new Date(2026, 2, 1), endDate: undefined, now })).toBeNull();
    expect(getPeriodProgress({ startDate: null, endDate: null, now })).toBeNull();
  });
});

describe('getTrackerPace', () => {
  const progress = {
    start: new Date(2026, 2, 1),
    end: new Date(2026, 2, 20),
    totalDays: 20,
    elapsedDays: 14,
    isActive: true,
  };

  it('projects the current pace to the end and compares with the limit', () => {
    const pace = getTrackerPace({ spent: 1778, limit: 2000, progress });
    expect(pace.dailyPace).toBe(127);
    expect(pace.allowedPerDay).toBe(100);
    expect(pace.projectedTotal).toBe(2540);
    expect(pace.projectedDelta).toBe(540);
  });

  it('skips limit-based values without a limit', () => {
    const pace = getTrackerPace({ spent: 1400, limit: null, progress });
    expect(pace.dailyPace).toBe(100);
    expect(pace.allowedPerDay).toBeNull();
    expect(pace.projectedTotal).toBe(2000);
    expect(pace.projectedDelta).toBeNull();
  });

  it('returns nulls without a period or before the start', () => {
    expect(getTrackerPace({ spent: 100, limit: 1000, progress: null })).toEqual({
      dailyPace: null,
      allowedPerDay: null,
      projectedTotal: null,
      projectedDelta: null,
    });
    expect(getTrackerPace({ spent: 0, limit: 1000, progress: { ...progress, elapsedDays: 0 } }).dailyPace).toBeNull();
  });
});

describe('getAveragePerDay', () => {
  it('divides by the inclusive transaction span', () => {
    expect(getAveragePerDay({ spent: 100, firstDate: '2026-03-01', lastDate: '2026-03-10' })).toBe(10);
  });

  it('returns null without dates', () => {
    expect(getAveragePerDay({ spent: 100, firstDate: null, lastDate: '2026-03-10' })).toBeNull();
  });
});

describe('getPercent', () => {
  it('returns 0 for an empty total', () => {
    expect(getPercent({ part: 5, total: 0 })).toBe(0);
    expect(getPercent({ part: 25, total: 200 })).toBe(12.5);
  });
});

describe('getCategorySplits', () => {
  it('sorts desc and computes shares of the top-level total', () => {
    const { items, total } = getCategorySplits({
      items: [
        { categoryId: '1' as RecordId, name: 'A', color: '#000', amount: 25 },
        { categoryId: '2' as RecordId, name: 'B', color: '#000', amount: 75, children: [] },
      ],
    });
    expect(total).toBe(100);
    expect(items.map((s) => [s.categoryId, s.percent])).toEqual([
      ['2', 75],
      ['1', 25],
    ]);
  });
});

describe('getCumulativeSeries', () => {
  it('accumulates net spent (expense minus income) in chronological order', () => {
    const series = getCumulativeSeries({
      periods: [
        { periodStart: '2026-03-02', periodEnd: '2026-03-02', expense: 5, income: 0 },
        { periodStart: '2026-03-01', periodEnd: '2026-03-01', expense: 10, income: 3 },
      ],
    });
    expect(series.map((p) => [p.periodStart, p.cumulative])).toEqual([
      ['2026-03-01', 7],
      ['2026-03-02', 12],
    ]);
  });

  it('floors the running net at zero without losing the carried income', () => {
    const series = getCumulativeSeries({
      periods: [
        { periodStart: '2026-03-01', periodEnd: '2026-03-01', expense: 0, income: 10 },
        { periodStart: '2026-03-02', periodEnd: '2026-03-02', expense: 4, income: 0 },
        { periodStart: '2026-03-03', periodEnd: '2026-03-03', expense: 20, income: 0 },
      ],
    });
    expect(series.map((p) => p.cumulative)).toEqual([0, 0, 14]);
  });
});
