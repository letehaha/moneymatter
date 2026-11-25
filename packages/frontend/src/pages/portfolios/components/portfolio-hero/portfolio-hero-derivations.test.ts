import type { PortfolioValueHistoryPointModel } from '@bt/shared/types/investments';

import {
  buildChartPoints,
  getHistoryRange,
  getPeriodStartDate,
  getPeriodStats,
  getTotalReturn,
} from './portfolio-hero-derivations';

const point = ({
  date,
  totalValue,
  netDeposits,
  twr,
}: {
  date: string;
  totalValue: number;
  netDeposits: number;
  twr: number;
}): PortfolioValueHistoryPointModel => ({
  date,
  totalValue: String(totalValue),
  holdingsValue: String(totalValue),
  cashValue: '0',
  costBasis: String(netDeposits),
  realizedGain: '0',
  netDeposits: String(netDeposits),
  timeWeightedReturn: String(twr),
});

const TODAY = new Date(2026, 10, 24);

const HISTORY = [
  point({ date: '2026-11-15', totalValue: 1000, netDeposits: 1000, twr: 0 }),
  point({ date: '2026-11-17', totalValue: 1100, netDeposits: 1000, twr: 0.1 }),
  point({ date: '2026-11-20', totalValue: 1650, netDeposits: 1500, twr: 0.1 }),
  point({ date: '2026-11-24', totalValue: 1815, netDeposits: 1500, twr: 0.21 }),
];

describe('getPeriodStartDate', () => {
  it('returns the window start for each period and null for all-time', () => {
    expect(getPeriodStartDate({ period: '1W', today: TODAY })).toBe('2026-11-17');
    expect(getPeriodStartDate({ period: 'YTD', today: TODAY })).toBe('2026-01-01');
    expect(getPeriodStartDate({ period: '1Y', today: TODAY })).toBe('2025-11-24');
    expect(getPeriodStartDate({ period: 'ALL', today: TODAY })).toBeNull();
  });

  it('clamps month offsets to the end of shorter months', () => {
    const monthEnd = new Date(2026, 2, 31);
    expect(getPeriodStartDate({ period: '1M', today: monthEnd })).toBe('2026-02-28');
    expect(getPeriodStartDate({ period: '3M', today: monthEnd })).toBe('2025-12-31');
    expect(getPeriodStartDate({ period: '6M', today: monthEnd })).toBe('2025-09-30');
  });
});

describe('getHistoryRange', () => {
  it('fetches a period from its start and all-time with server thinning', () => {
    expect(getHistoryRange({ period: '1W', today: TODAY })).toEqual({ from: '2026-11-17' });
    expect(getHistoryRange({ period: 'ALL', today: TODAY })).toEqual({ interval: 'auto' });
  });
});

describe('buildChartPoints', () => {
  it('slices to the period and rebases the return to its first day', () => {
    const points = buildChartPoints({ points: HISTORY, period: '1W', today: TODAY });

    expect(points.map((p) => p.date)).toEqual(['2026-11-17', '2026-11-20', '2026-11-24']);
    expect(points[0]!.returnPct).toBe(0);
    expect(points[2]!.returnPct).toBeCloseTo(0.1);
  });

  it('yields no points for an empty history or a wiped-out base', () => {
    expect(buildChartPoints({ points: [], period: 'ALL', today: TODAY })).toEqual([]);

    const wiped = buildChartPoints({
      points: [
        point({ date: '2026-11-23', totalValue: 0, netDeposits: 100, twr: -1 }),
        point({ date: '2026-11-24', totalValue: 10, netDeposits: 110, twr: -0.9 }),
      ],
      period: 'ALL',
      today: TODAY,
    });
    expect(wiped).toEqual([]);
  });

  it('yields no points when the period starts after the last history row', () => {
    expect(buildChartPoints({ points: HISTORY, period: '1W', today: new Date(2026, 11, 31) })).toEqual([]);
  });

  it('skips rows with non-numeric values', () => {
    const corrupt = {
      ...point({ date: '2026-11-18', totalValue: 0, netDeposits: 0, twr: 0 }),
      timeWeightedReturn: 'NaN',
    };
    const points = buildChartPoints({
      points: [HISTORY[0]!, corrupt, HISTORY[1]!],
      period: 'ALL',
      today: TODAY,
    });

    expect(points.map((p) => p.date)).toEqual(['2026-11-15', '2026-11-17']);
  });
});

describe('getPeriodStats', () => {
  it('excludes deposits from the market gain', () => {
    const points = buildChartPoints({ points: HISTORY, period: '1W', today: TODAY });
    const stats = getPeriodStats({ points });

    expect(stats!.marketGain).toBe(1815 - 1100 - 500);
    expect(stats!.returnPct).toBeCloseTo(0.1);
  });

  it('returns null without points', () => {
    expect(getPeriodStats({ points: [] })).toBeNull();
  });

  it('returns null for a single point', () => {
    const points = buildChartPoints({ points: [HISTORY[0]!], period: 'ALL', today: TODAY });

    expect(points).toHaveLength(1);
    expect(getPeriodStats({ points })).toBeNull();
  });
});

describe('getTotalReturn', () => {
  it('is null while net deposits are unknown', () => {
    expect(getTotalReturn({ totalValue: 100, netDeposits: null })).toBeNull();
  });

  it('measures the gain against positive deposits', () => {
    expect(getTotalReturn({ totalValue: 1200, netDeposits: 1000 })).toEqual({ amount: 200, pct: 0.2 });
  });

  it('has no percentage for zero or negative deposits', () => {
    expect(getTotalReturn({ totalValue: 50, netDeposits: 0 })).toEqual({ amount: 50, pct: null });
    expect(getTotalReturn({ totalValue: 50, netDeposits: -100 })).toEqual({ amount: 150, pct: null });
  });
});
