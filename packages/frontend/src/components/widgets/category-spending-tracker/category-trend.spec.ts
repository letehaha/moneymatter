import { endOfMonth } from 'date-fns';
import { describe, expect, it } from 'vitest';

import { buildSparklinePoints, getTrendRange, orientTrend } from './category-trend';

describe('getTrendRange', () => {
  it('covers the six full months before the month the period ends in', () => {
    expect(getTrendRange({ periodEnd: new Date(2026, 9, 20) })).toEqual({
      from: new Date(2026, 3, 1),
      to: endOfMonth(new Date(2026, 8, 1)),
    });
  });

  it('crosses the year boundary', () => {
    expect(getTrendRange({ periodEnd: new Date(2026, 0, 10) })).toEqual({
      from: new Date(2025, 6, 1),
      to: endOfMonth(new Date(2025, 11, 1)),
    });
  });
});

describe('orientTrend', () => {
  it('flips an expense row so more spending plots higher', () => {
    expect(orientTrend({ values: [-10, -30], netAmount: -20 })).toEqual([10, 30]);
  });

  it('keeps an income row as is', () => {
    expect(orientTrend({ values: [100, 50], netAmount: 80 })).toEqual([100, 50]);
  });

  it('falls back to the trend sign when the row amount is zero', () => {
    expect(orientTrend({ values: [-5, -15], netAmount: 0 })).toEqual([5, 15]);
  });
});

describe('buildSparklinePoints', () => {
  it('puts the max at the top and the min at the bottom of the padded box', () => {
    expect(buildSparklinePoints({ values: [0, 10, 5], width: 64, height: 20, padding: 2 })).toEqual([
      { x: 2, y: 18 },
      { x: 32, y: 2 },
      { x: 62, y: 10 },
    ]);
  });

  it('draws a flat series on the vertical middle', () => {
    expect(buildSparklinePoints({ values: [3, 3], width: 64, height: 20, padding: 2 }).map((p) => p.y)).toEqual([
      10, 10,
    ]);
  });
});
