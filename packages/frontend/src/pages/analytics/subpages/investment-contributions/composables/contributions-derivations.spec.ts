import type {
  InvestmentContributionsBucket,
  InvestmentContributionsPortfolioMeta,
  GetInvestmentContributionsResponse,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  buildContributionsChartModel,
  computeVsPreviousPeriodPct,
  sharePctOfSavings,
  shouldShowMomChangeLabel,
} from './contributions-derivations';

const PORTFOLIO_A = { portfolioId: 'portfolio-a', name: 'Portfolio A' };
const PORTFOLIO_B = { portfolioId: 'portfolio-b', name: 'Portfolio B' };
const PORTFOLIO_C = { portfolioId: 'portfolio-c', name: 'Portfolio C' };

const PALETTE = ['red', 'green', 'blue'];

const buildBucket = ({
  periodStart,
  periodEnd,
  total,
  byPortfolio = [],
  savingsNet = 0,
}: {
  periodStart: string;
  periodEnd: string;
  total: number;
  byPortfolio?: { portfolioId: string; amount: number }[];
  savingsNet?: number;
}): InvestmentContributionsBucket => ({ periodStart, periodEnd, total, byPortfolio, savingsNet });

const buildResponse = ({
  buckets,
  portfolios,
}: {
  buckets: InvestmentContributionsBucket[];
  portfolios?: InvestmentContributionsPortfolioMeta[];
}): GetInvestmentContributionsResponse => ({
  buckets,
  portfolios: portfolios ?? [PORTFOLIO_A, PORTFOLIO_B],
});

describe('buildContributionsChartModel', () => {
  describe('legend color assignment', () => {
    it('assigns colors by index into the palette', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({ buckets: [], portfolios: [PORTFOLIO_A, PORTFOLIO_B, PORTFOLIO_C] }),
        palette: PALETTE,
      });

      expect(model.legend).toEqual([
        { portfolioId: 'portfolio-a', name: 'Portfolio A', color: 'red' },
        { portfolioId: 'portfolio-b', name: 'Portfolio B', color: 'green' },
        { portfolioId: 'portfolio-c', name: 'Portfolio C', color: 'blue' },
      ]);
    });

    it('cycles the palette with modulo when there are more portfolios than colors', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [],
          portfolios: [PORTFOLIO_A, PORTFOLIO_B, PORTFOLIO_C, { portfolioId: 'portfolio-d', name: 'Portfolio D' }],
        }),
        palette: PALETTE,
      });

      expect(model.legend.map((entry) => entry.color)).toEqual(['red', 'green', 'blue', 'red']);
    });

    it('returns an empty legend for no portfolios', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({ buckets: [], portfolios: [] }),
        palette: PALETTE,
      });

      expect(model.legend).toEqual([]);
    });
  });

  describe('segment expansion', () => {
    it('expands a sparse bucket into dense, legend-ordered segments with zero fills', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({
              periodStart: '2026-01-01',
              periodEnd: '2026-01-31',
              total: 500,
              byPortfolio: [{ portfolioId: 'portfolio-b', amount: 500 }],
            }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.bars[0]!.segments).toEqual([
        { portfolioId: 'portfolio-a', name: 'Portfolio A', color: 'red', amount: 0 },
        { portfolioId: 'portfolio-b', name: 'Portfolio B', color: 'green', amount: 500 },
      ]);
    });

    it('carries a negative slice through as a negative segment amount', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({
              periodStart: '2026-01-01',
              periodEnd: '2026-01-31',
              total: -200,
              byPortfolio: [{ portfolioId: 'portfolio-a', amount: -200 }],
            }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.bars[0]!.segments.find((s) => s.portfolioId === 'portfolio-a')!.amount).toBe(-200);
    });
  });

  describe('momChangePct', () => {
    it('is undefined for the first bar', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 1000 })],
        }),
        palette: PALETTE,
      });

      expect(model.bars[0]!.momChangePct).toBeUndefined();
    });

    it('computes a normal percent change against the previous bar', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 1000 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: 1500 }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.bars[1]!.momChangePct).toBe(50);
    });

    it('reports +100 when the previous total was zero and this one is positive', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 0 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: 300 }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.bars[1]!.momChangePct).toBe(100);
    });

    it('reports -100 when the previous total was zero and this one is negative', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 0 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: -300 }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.bars[1]!.momChangePct).toBe(-100);
    });

    it('reports 0 when both totals are zero', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 0 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: 0 }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.bars[1]!.momChangePct).toBe(0);
    });

    it('handles a swing from a net contribution to a net withdrawal', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 400 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: -200 }),
          ],
        }),
        palette: PALETTE,
      });

      // (-200 - 400) / |400| * 100 = -150
      expect(model.bars[1]!.momChangePct).toBe(-150);
    });

    it('handles two negative totals getting worse', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: -100 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: -300 }),
          ],
        }),
        palette: PALETTE,
      });

      // (-300 - -100) / |-100| * 100 = -200
      expect(model.bars[1]!.momChangePct).toBe(-200);
    });
  });

  describe('showMomChangeLabel on bars', () => {
    it('labels only transitions between two strictly positive months', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 0 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: 300 }),
            buildBucket({ periodStart: '2026-03-01', periodEnd: '2026-03-31', total: 200 }),
            buildBucket({ periodStart: '2026-04-01', periodEnd: '2026-04-30', total: -50 }),
            buildBucket({ periodStart: '2026-05-01', periodEnd: '2026-05-31', total: 100 }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.bars.map((bar) => bar.showMomChangeLabel)).toEqual([
        false, // first bar has nothing to compare against
        false, // 0 -> 300: zero baseline
        true, // 300 -> 200: both strictly positive
        false, // 200 -> -50: sign flip into a withdrawal
        false, // -50 -> 100: negative baseline
      ]);
    });
  });

  describe('average', () => {
    it('is null with fewer than 3 bars', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 100 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: 200 }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.average).toBeNull();
    });

    it('is the mean of bar totals at 3 or more bars', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 100 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: 200 }),
            buildBucket({ periodStart: '2026-03-01', periodEnd: '2026-03-31', total: 300 }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.average).toBe(200);
    });
  });

  describe('averagePerPeriod, rangeTotal, savingsTotal', () => {
    it('spreads the range total evenly across bars', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 100, savingsNet: 500 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: 300, savingsNet: 700 }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.rangeTotal).toBe(400);
      expect(model.averagePerPeriod).toBe(200);
      expect(model.savingsTotal).toBe(1200);
    });

    it('is all zero for no buckets', () => {
      const model = buildContributionsChartModel({ response: buildResponse({ buckets: [] }), palette: PALETTE });

      expect(model.rangeTotal).toBe(0);
      expect(model.averagePerPeriod).toBe(0);
      expect(model.savingsTotal).toBe(0);
      expect(model.average).toBeNull();
    });

    it('sums a mix of positive and negative totals', () => {
      const model = buildContributionsChartModel({
        response: buildResponse({
          buckets: [
            buildBucket({ periodStart: '2026-01-01', periodEnd: '2026-01-31', total: 500 }),
            buildBucket({ periodStart: '2026-02-01', periodEnd: '2026-02-28', total: -300 }),
          ],
        }),
        palette: PALETTE,
      });

      expect(model.rangeTotal).toBe(200);
    });
  });
});

describe('computeVsPreviousPeriodPct', () => {
  it('computes a normal percent change', () => {
    expect(computeVsPreviousPeriodPct({ currentTotal: 1500, previousTotal: 1000 })).toBe(50);
  });

  it('reports +100 when the previous period was zero and this one is positive', () => {
    expect(computeVsPreviousPeriodPct({ currentTotal: 300, previousTotal: 0 })).toBe(100);
  });

  it('reports -100 when the previous period was zero and this one is negative', () => {
    expect(computeVsPreviousPeriodPct({ currentTotal: -300, previousTotal: 0 })).toBe(-100);
  });

  it('reports 0 when both periods are zero', () => {
    expect(computeVsPreviousPeriodPct({ currentTotal: 0, previousTotal: 0 })).toBe(0);
  });

  it('handles a negative previous period', () => {
    expect(computeVsPreviousPeriodPct({ currentTotal: 100, previousTotal: -100 })).toBe(200);
  });
});

describe('sharePctOfSavings', () => {
  it('computes the share as a rounded percent', () => {
    expect(sharePctOfSavings({ rangeTotal: 250, savingsTotal: 1000 })).toBe(25);
  });

  it('rounds to the nearest whole percent', () => {
    expect(sharePctOfSavings({ rangeTotal: 333, savingsTotal: 1000 })).toBe(33);
  });

  it('is null when savings total is zero', () => {
    expect(sharePctOfSavings({ rangeTotal: 250, savingsTotal: 0 })).toBeNull();
  });

  it('is null when savings total is negative', () => {
    expect(sharePctOfSavings({ rangeTotal: 250, savingsTotal: -100 })).toBeNull();
  });

  it('can exceed 100 when contributions outpace savings (e.g. funded from existing cash)', () => {
    expect(sharePctOfSavings({ rangeTotal: 1500, savingsTotal: 1000 })).toBe(150);
  });
});

describe('shouldShowMomChangeLabel', () => {
  it('shows the label when both totals are strictly positive', () => {
    expect(shouldShowMomChangeLabel({ previousTotal: 100, currentTotal: 200 })).toBe(true);
  });

  it('hides the label when the previous total is zero', () => {
    expect(shouldShowMomChangeLabel({ previousTotal: 0, currentTotal: 200 })).toBe(false);
  });

  it('hides the label when the current total is zero', () => {
    expect(shouldShowMomChangeLabel({ previousTotal: 100, currentTotal: 0 })).toBe(false);
  });

  it('hides the label when the previous total is negative', () => {
    expect(shouldShowMomChangeLabel({ previousTotal: -100, currentTotal: 200 })).toBe(false);
  });

  it('hides the label when the current total is negative', () => {
    expect(shouldShowMomChangeLabel({ previousTotal: 100, currentTotal: -200 })).toBe(false);
  });
});
