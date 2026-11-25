import { describe, expect, it } from '@jest/globals';

import {
  type SeriesPoint,
  computeMaxDrawdown,
  computeMoneyWeightedReturn,
  computeMonthlyMarketGain,
  computeTimeWeightedReturns,
} from './analytics-math';

const point = ({
  date,
  totalValue = 0,
  netDeposits = 0,
  timeWeightedReturn = 0,
}: Partial<SeriesPoint> & { date: string }): SeriesPoint => ({ date, totalValue, netDeposits, timeWeightedReturn });

describe('computeMaxDrawdown', () => {
  it('reports a drop still below its peak as unrecovered', () => {
    const drawdown = computeMaxDrawdown({
      points: [
        point({ date: '2026-01-01', timeWeightedReturn: 0 }),
        point({ date: '2026-01-02', timeWeightedReturn: 0.2 }),
        point({ date: '2026-01-03', timeWeightedReturn: -0.1 }),
        point({ date: '2026-01-04', timeWeightedReturn: 0 }),
      ],
    });

    expect(drawdown).toMatchObject({ peakDate: '2026-01-02', troughDate: '2026-01-03', recoveredDate: null });
    expect(Number(drawdown!.value)).toBeCloseTo(0.9 / 1.2 - 1, 8);
  });

  it('is null when the index never falls', () => {
    expect(
      computeMaxDrawdown({
        points: [
          point({ date: '2026-01-01', timeWeightedReturn: 0 }),
          point({ date: '2026-01-02', timeWeightedReturn: 0.1 }),
          point({ date: '2026-01-03', timeWeightedReturn: 0.1 }),
        ],
      }),
    ).toBeNull();
  });
});

describe('computeMonthlyMarketGain', () => {
  it('gives a single point a zero gain for its month', () => {
    expect(
      computeMonthlyMarketGain({ points: [point({ date: '2026-03-15', totalValue: 100, netDeposits: 100 })] }),
    ).toEqual([{ month: '2026-03', gain: '0.00' }]);
  });
});

describe('computeMoneyWeightedReturn', () => {
  const START = '2025-01-01';
  const END = '2026-01-01';

  it('annualizes a deposit grown to a terminal value', () => {
    const rate = computeMoneyWeightedReturn({
      points: [
        point({ date: START, totalValue: 1000, netDeposits: 1000 }),
        point({ date: END, totalValue: 1100, netDeposits: 1000 }),
      ],
    });

    expect(Number(rate)).toBeCloseTo(0.1, 3);
  });

  it('is null when every flow goes one way', () => {
    const allDeposits = computeMoneyWeightedReturn({
      points: [
        point({ date: START, totalValue: 0, netDeposits: 1000 }),
        point({ date: END, totalValue: 0, netDeposits: 2000 }),
      ],
    });
    const withdrawalOnly = computeMoneyWeightedReturn({
      points: [
        point({ date: START, totalValue: 500, netDeposits: -500 }),
        point({ date: END, totalValue: 600, netDeposits: -500 }),
      ],
    });

    expect(allDeposits).toBeNull();
    expect(withdrawalOnly).toBeNull();
  });

  it('is null under the minimum history', () => {
    expect(
      computeMoneyWeightedReturn({
        points: [
          point({ date: '2026-01-01', totalValue: 1000, netDeposits: 1000 }),
          point({ date: '2026-02-01', totalValue: 1100, netDeposits: 1000 }),
        ],
      }),
    ).toBeNull();
  });
});

describe('computeTimeWeightedReturns', () => {
  it('stays flat on a deposit day and follows the price after it', () => {
    expect(
      computeTimeWeightedReturns({
        days: [
          { holdingsValue: 0, cashValue: 0, flow: 0 },
          { holdingsValue: 0, cashValue: 1000, flow: 1000 },
          { holdingsValue: 1100, cashValue: 0, flow: 0 },
        ],
      }),
    ).toEqual([0, 0, expect.closeTo(0.1, 10)]);
  });

  it('counts cash a buy pulls below zero as capital brought in', () => {
    expect(
      computeTimeWeightedReturns({
        days: [
          { holdingsValue: 0, cashValue: 0, flow: 0 },
          { holdingsValue: 1000, cashValue: -1000, flow: 0 },
          { holdingsValue: 1100, cashValue: -1000, flow: 0 },
        ],
      }),
    ).toEqual([0, 0, expect.closeTo(0.1, 10)]);
  });

  it('carries the index across a withdrawal that leaves a residue below the minimum base', () => {
    expect(
      computeTimeWeightedReturns({
        days: [
          { holdingsValue: 0, cashValue: 1000, flow: 1000 },
          { holdingsValue: 1100, cashValue: 0, flow: 0 },
          { holdingsValue: 0, cashValue: 0.4, flow: -1099.6 },
          { holdingsValue: 0, cashValue: 0.8, flow: 0 },
        ],
      }),
    ).toEqual([0, expect.closeTo(0.1, 10), expect.closeTo(0.1, 10), expect.closeTo(0.1, 10)]);
  });
});
