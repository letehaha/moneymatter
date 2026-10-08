import type {
  NetWorthDriversPortfolioSlice,
  NetWorthDriversBucket,
  NetWorthDriversPortfolioMeta,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  MAX_PORTFOLIO_SERIES,
  OTHERS_SERIES_ID,
  buildBreakdownModel,
  buildCumulativeSeries,
  computeAllocationContext,
  computeHoldingsSharePct,
  deriveTargetSeeds,
  hasAnyData,
  hasPortfolios,
} from './net-worth-drivers-derivations';

const buildBucket = ({
  periodStart,
  periodEnd,
  savingsNet = 0,
  growth = 0,
  priceEffect,
  dividends = 0,
  feesAndTaxes = 0,
  holdingsValue = 0,
  cashValue = 0,
  byPortfolio = [],
}: {
  periodStart: string;
  periodEnd: string;
  savingsNet?: number;
  growth?: number;
  priceEffect?: number;
  dividends?: number;
  feesAndTaxes?: number;
  holdingsValue?: number;
  cashValue?: number;
  byPortfolio?: NetWorthDriversPortfolioSlice[];
}): NetWorthDriversBucket => ({
  periodStart,
  periodEnd,
  savings: { income: Math.max(savingsNet, 0), expenses: Math.max(-savingsNet, 0), net: savingsNet },
  investments: { growth, priceEffect: priceEffect ?? growth, dividends, feesAndTaxes, byPortfolio },
  composition: { holdingsValue, cashValue },
});

const monthlyBucket = ({
  month,
  ...rest
}: {
  month: number;
  savingsNet?: number;
  growth?: number;
  byPortfolio?: NetWorthDriversPortfolioSlice[];
}) => {
  const padded = String(month).padStart(2, '0');
  const lastDay = month === 2 ? '28' : '30';
  return buildBucket({ periodStart: `2026-${padded}-01`, periodEnd: `2026-${padded}-${lastDay}`, ...rest });
};

const buildPortfolios = ({ count }: { count: number }): NetWorthDriversPortfolioMeta[] =>
  Array.from({ length: count }, (_, index) => ({ portfolioId: `p${index + 1}`, name: `Portfolio ${index + 1}` }));

describe('buildCumulativeSeries', () => {
  it('accumulates both series across buckets', () => {
    const series = buildCumulativeSeries({
      buckets: [
        monthlyBucket({ month: 1, savingsNet: 100, growth: 10 }),
        monthlyBucket({ month: 2, savingsNet: 200, growth: 20 }),
        monthlyBucket({ month: 3, savingsNet: 300, growth: 30 }),
      ],
    });

    expect(series.map((point) => point.savedCumulative)).toEqual([100, 300, 600]);
    expect(series.map((point) => point.grownCumulative)).toEqual([10, 30, 60]);
  });

  it('keeps each bucket own delta alongside the running total', () => {
    const series = buildCumulativeSeries({
      buckets: [
        monthlyBucket({ month: 1, savingsNet: 100, growth: 10 }),
        monthlyBucket({ month: 2, savingsNet: 200, growth: 20 }),
      ],
    });

    expect(series[1]).toMatchObject({ savingsNet: 200, growth: 20, savedCumulative: 300, grownCumulative: 30 });
  });

  it('lets a losing bucket bend the running total back down', () => {
    const series = buildCumulativeSeries({
      buckets: [monthlyBucket({ month: 1, growth: 500 }), monthlyBucket({ month: 2, growth: -800 })],
    });

    expect(series.map((point) => point.grownCumulative)).toEqual([500, -300]);
  });

  it('carries a cumulative series negative when the window starts on a drawdown', () => {
    const series = buildCumulativeSeries({
      buckets: [monthlyBucket({ month: 1, growth: -400 }), monthlyBucket({ month: 2, growth: -300 })],
    });

    expect(series.map((point) => point.grownCumulative)).toEqual([-400, -700]);
  });

  it('returns nothing for no buckets', () => {
    expect(buildCumulativeSeries({ buckets: [] })).toEqual([]);
  });
});

describe('deriveTargetSeeds', () => {
  it('takes the current value from the last bucket and averages saving per month', () => {
    const seeds = deriveTargetSeeds({
      buckets: [
        monthlyBucket({ month: 1, savingsNet: 1000 }),
        monthlyBucket({ month: 2, savingsNet: 2000 }),
        buildBucket({ periodStart: '2026-03-01', periodEnd: '2026-03-31', savingsNet: 3000, holdingsValue: 50_000 }),
      ],
    });

    // Jan 1 to Mar 31 is ~3 months, so $6,000 saved averages to ~$2,000/mo.
    expect(seeds.currentPortfolioValue).toBe(50_000);
    expect(seeds.avgMonthlySavings).toBeCloseTo(2000, 0);
  });

  it('carries a net drawdown through as a negative average', () => {
    const seeds = deriveTargetSeeds({
      buckets: [monthlyBucket({ month: 1, savingsNet: -400 }), monthlyBucket({ month: 2, savingsNet: -600 })],
    });

    expect(seeds.avgMonthlySavings).toBeLessThan(0);
  });

  it('is all zeroes for no buckets', () => {
    expect(deriveTargetSeeds({ buckets: [] })).toEqual({ currentPortfolioValue: 0, avgMonthlySavings: 0 });
  });

  it('never divides saving by less than a month for a sub-month window', () => {
    // A single short bucket would otherwise annualize a few days of saving into a
    // wild monthly figure; the floor keeps the seed at the amount actually saved.
    const seeds = deriveTargetSeeds({
      buckets: [
        buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-05', savingsNet: 500, holdingsValue: 100 }),
      ],
    });

    expect(seeds.avgMonthlySavings).toBe(500);
  });
});

describe('computeHoldingsSharePct', () => {
  it('reports holdings as a share of holdings plus cash', () => {
    expect(computeHoldingsSharePct({ composition: { holdingsValue: 600, cashValue: 400 } })).toBe(60);
  });

  it('reports zero when nothing is invested', () => {
    expect(computeHoldingsSharePct({ composition: { holdingsValue: 0, cashValue: 400 } })).toBe(0);
  });

  it('is undefined when assets and debts cancel out', () => {
    expect(computeHoldingsSharePct({ composition: { holdingsValue: 0, cashValue: 0 } })).toBeNull();
  });

  it('is undefined when debt outweighs assets', () => {
    // A share of a negative total would flip sign instead of reading as a proportion.
    expect(computeHoldingsSharePct({ composition: { holdingsValue: 100, cashValue: -400 } })).toBeNull();
  });
});

describe('hasAnyData', () => {
  it('is false for a window of all-zero buckets', () => {
    expect(hasAnyData({ buckets: [monthlyBucket({ month: 1 }), monthlyBucket({ month: 2 })] })).toBe(false);
  });

  it('is false for no buckets', () => {
    expect(hasAnyData({ buckets: [] })).toBe(false);
  });

  it('counts a non-zero savings net as data', () => {
    expect(hasAnyData({ buckets: [monthlyBucket({ month: 1, savingsNet: 100 })] })).toBe(true);
  });

  it('counts investment growth as data', () => {
    expect(hasAnyData({ buckets: [monthlyBucket({ month: 1, growth: 50 })] })).toBe(true);
  });

  it('counts standing holdings as data even without any flow', () => {
    const bucket = buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', holdingsValue: 1000 });
    expect(hasAnyData({ buckets: [bucket] })).toBe(true);
  });

  it('counts standing cash as data even without any flow', () => {
    const bucket = buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', cashValue: 1000 });
    expect(hasAnyData({ buckets: [bucket] })).toBe(true);
  });
});

describe('hasPortfolios', () => {
  it('is false when only savings and cash are present', () => {
    // Cash and income alone are not evidence a portfolio ever existed.
    const bucket = buildBucket({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      savingsNet: 100,
      cashValue: 5000,
    });
    expect(hasPortfolios({ buckets: [bucket] })).toBe(false);
  });

  it('is false for no buckets', () => {
    expect(hasPortfolios({ buckets: [] })).toBe(false);
  });

  it('counts standing holdings as a portfolio', () => {
    const bucket = buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', holdingsValue: 1000 });
    expect(hasPortfolios({ buckets: [bucket] })).toBe(true);
  });

  it('still finds a portfolio for a user who sold everything mid-window', () => {
    // Holdings drain to zero on the sale, but the growth booked before it proves a portfolio existed —
    // the case where reading holdingsValue alone would wrongly report "no portfolios".
    const bucket = buildBucket({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      holdingsValue: 0,
      cashValue: 3000,
      growth: -50,
    });
    expect(hasPortfolios({ buckets: [bucket] })).toBe(true);
  });

  it('counts a fee-only bucket with no standing holdings as a portfolio', () => {
    const bucket = buildBucket({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      holdingsValue: 0,
      feesAndTaxes: 12,
    });
    expect(hasPortfolios({ buckets: [bucket] })).toBe(true);
  });
});

describe('computeAllocationContext', () => {
  it('is all null for no buckets', () => {
    expect(computeAllocationContext({ buckets: [] })).toEqual({
      currentSharePct: null,
      referenceSharePct: null,
      referencePeriodEnd: null,
    });
  });

  it('reports only the current share from a single bucket', () => {
    const context = computeAllocationContext({
      buckets: [
        buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', holdingsValue: 500, cashValue: 500 }),
      ],
    });

    expect(context.currentSharePct).toBe(50);
    expect(context.referenceSharePct).toBeNull();
    expect(context.referencePeriodEnd).toBeNull();
  });

  it('is all null when no bucket has a defined share', () => {
    expect(
      computeAllocationContext({
        buckets: [
          buildBucket({ periodStart: '2025-01-01', periodEnd: '2025-01-31', holdingsValue: 0, cashValue: 0 }),
          buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', holdingsValue: 0, cashValue: 0 }),
        ],
      }),
    ).toEqual({ currentSharePct: null, referenceSharePct: null, referencePeriodEnd: null });
  });

  it('picks the reference nearest a year back rather than the oldest', () => {
    const context = computeAllocationContext({
      buckets: [
        buildBucket({ periodStart: '2022-01-01', periodEnd: '2022-01-31', holdingsValue: 100, cashValue: 900 }),
        buildBucket({ periodStart: '2025-01-01', periodEnd: '2025-01-31', holdingsValue: 480, cashValue: 520 }),
        buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', holdingsValue: 610, cashValue: 390 }),
      ],
    });

    expect(context.currentSharePct).toBeCloseTo(61, 5);
    expect(context.referenceSharePct).toBeCloseTo(48, 5);
    expect(context.referencePeriodEnd).toBe('2025-01-31');
  });

  it('ignores buckets whose share is undefined when picking the reference', () => {
    const context = computeAllocationContext({
      buckets: [
        buildBucket({ periodStart: '2024-01-01', periodEnd: '2024-01-31', holdingsValue: 0, cashValue: 0 }),
        buildBucket({ periodStart: '2025-01-01', periodEnd: '2025-01-31', holdingsValue: 480, cashValue: 520 }),
        buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', holdingsValue: 610, cashValue: 390 }),
      ],
    });

    expect(context.referencePeriodEnd).toBe('2025-01-31');
  });

  it('falls back to the oldest bucket when history is shorter than a year', () => {
    const context = computeAllocationContext({
      buckets: [
        buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', holdingsValue: 500, cashValue: 500 }),
        buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', holdingsValue: 550, cashValue: 450 }),
      ],
    });

    expect(context.currentSharePct).toBeCloseTo(55, 5);
    expect(context.referenceSharePct).toBeCloseTo(50, 5);
    expect(context.referencePeriodEnd).toBe('2026-01-31');
  });
});

describe('buildBreakdownModel', () => {
  it('gives every portfolio its own legend colour and no Others entry when they fit', () => {
    const { legend } = buildBreakdownModel({
      buckets: [monthlyBucket({ month: 1, growth: 30, byPortfolio: [{ portfolioId: 'p1', growth: 30 }] })],
      portfolios: buildPortfolios({ count: 3 }),
    });

    expect(legend.map((entry) => entry.portfolioId)).toEqual(['p1', 'p2', 'p3']);
    expect(new Set(legend.map((entry) => entry.color)).size).toBe(3);
  });

  it('never colours a portfolio with the emerald reserved for Saved', () => {
    const { legend } = buildBreakdownModel({
      buckets: [],
      portfolios: buildPortfolios({ count: MAX_PORTFOLIO_SERIES }),
    });

    expect(legend.map((entry) => entry.color)).not.toContain('rgb(16, 185, 129)');
  });

  it('carries saved and growth totals through per bucket', () => {
    const { bars } = buildBreakdownModel({
      buckets: [
        monthlyBucket({ month: 1, savingsNet: 500, growth: 30, byPortfolio: [{ portfolioId: 'p1', growth: 30 }] }),
        monthlyBucket({ month: 2, savingsNet: -200, growth: 0 }),
      ],
      portfolios: buildPortfolios({ count: 1 }),
    });

    expect(bars.map((bar) => bar.savedNet)).toEqual([500, -200]);
    expect(bars.map((bar) => bar.growthTotal)).toEqual([30, 0]);
    expect(bars.map((bar) => bar.periodStart)).toEqual(['2026-01-01', '2026-02-01']);
  });

  it('fills a zero segment for every portfolio missing from a sparse bucket', () => {
    const { bars } = buildBreakdownModel({
      buckets: [monthlyBucket({ month: 1, growth: 40, byPortfolio: [{ portfolioId: 'p2', growth: 40 }] })],
      portfolios: buildPortfolios({ count: 3 }),
    });

    expect(bars[0]!.segments.map((segment) => [segment.portfolioId, segment.growth])).toEqual([
      ['p1', 0],
      ['p2', 40],
      ['p3', 0],
    ]);
  });

  it('keeps segments in legend order so a colour means the same portfolio across bars', () => {
    const { legend, bars } = buildBreakdownModel({
      buckets: [
        monthlyBucket({ month: 1, growth: 10, byPortfolio: [{ portfolioId: 'p3', growth: 10 }] }),
        monthlyBucket({ month: 2, growth: 20, byPortfolio: [{ portfolioId: 'p1', growth: 20 }] }),
      ],
      portfolios: buildPortfolios({ count: 3 }),
    });

    for (const bar of bars) {
      expect(bar.segments.map((segment) => segment.portfolioId)).toEqual(legend.map((entry) => entry.portfolioId));
      expect(bar.segments.map((segment) => segment.color)).toEqual(legend.map((entry) => entry.color));
    }
  });

  it('folds everything past the top eight into a single Others segment', () => {
    const portfolios = buildPortfolios({ count: 11 });
    const { legend, bars } = buildBreakdownModel({
      buckets: [
        monthlyBucket({
          month: 1,
          growth: 60,
          byPortfolio: [
            { portfolioId: 'p1', growth: 30 },
            { portfolioId: 'p9', growth: 10 },
            { portfolioId: 'p10', growth: 15 },
            { portfolioId: 'p11', growth: 5 },
          ],
        }),
      ],
      portfolios,
    });

    expect(legend).toHaveLength(MAX_PORTFOLIO_SERIES + 1);
    expect(legend[legend.length - 1]).toMatchObject({ portfolioId: OTHERS_SERIES_ID, name: '' });

    const segments = bars[0]!.segments;
    expect(segments[segments.length - 1]).toMatchObject({ portfolioId: OTHERS_SERIES_ID, growth: 30 });
    expect(segments.reduce((sum, segment) => sum + segment.growth, 0)).toBe(60);
  });

  it('nets a losing tail portfolio against a winning one inside Others', () => {
    const { bars } = buildBreakdownModel({
      buckets: [
        monthlyBucket({
          month: 1,
          growth: -20,
          byPortfolio: [
            { portfolioId: 'p9', growth: 40 },
            { portfolioId: 'p10', growth: -60 },
          ],
        }),
      ],
      portfolios: buildPortfolios({ count: 10 }),
    });

    const others = bars[0]!.segments.find((segment) => segment.portfolioId === OTHERS_SERIES_ID);
    expect(others?.growth).toBe(-20);
  });

  it('keeps negative portfolio growth signed', () => {
    const { bars } = buildBreakdownModel({
      buckets: [
        monthlyBucket({
          month: 1,
          savingsNet: 100,
          growth: -50,
          byPortfolio: [
            { portfolioId: 'p1', growth: -80 },
            { portfolioId: 'p2', growth: 30 },
          ],
        }),
      ],
      portfolios: buildPortfolios({ count: 2 }),
    });

    expect(bars[0]!.segments.map((segment) => segment.growth)).toEqual([-80, 30]);
    expect(bars[0]!.growthTotal).toBe(-50);
  });

  it('returns no bars for an empty window but keeps the legend', () => {
    const model = buildBreakdownModel({ buckets: [], portfolios: buildPortfolios({ count: 2 }) });

    expect(model.bars).toEqual([]);
    expect(model.legend).toHaveLength(2);
  });

  it('returns an empty model when there is nothing at all', () => {
    expect(buildBreakdownModel({ buckets: [], portfolios: [] })).toEqual({ legend: [], bars: [] });
  });
});
