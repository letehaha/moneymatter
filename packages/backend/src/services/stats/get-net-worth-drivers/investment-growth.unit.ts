import { type Cents, INVESTMENT_TRANSACTION_CATEGORY, asCents } from '@bt/shared/types';

import {
  type InvestmentGrowthCents,
  type PortfolioGrowthSeries,
  accumulateInvestmentFlows,
  computeInvestmentGrowth,
  foldPortfolioGrowth,
} from './investment-growth';
import type { InvestmentFlowRow, InvestmentFlowsCents } from './types';

// `InvestmentFlowRow` mirrors a `raw: true` query result — DECIMAL fields are
// plain strings, exactly as the pg driver returns them.
const buildTx = ({
  category,
  date,
  amount,
  fees = 0,
}: {
  category: INVESTMENT_TRANSACTION_CATEGORY;
  date: string;
  /** Decimal, as `refAmount` is stored: quantity * price + fees (buy) or - fees (sell/dividend). */
  amount: number;
  fees?: number;
}): InvestmentFlowRow => ({
  category,
  date: new Date(`${date}T12:00:00.000Z`),
  refAmount: String(amount),
  refFees: String(fees),
});

/** Cents-branded flow bucket from decimal-free integer inputs, defaulting each leg to zero. */
const flowsBucket = ({
  buyNotional = 0,
  sellNotional = 0,
  dividendsGross = 0,
  feesAndTaxes = 0,
}: Partial<Record<keyof InvestmentFlowsCents, number>> = {}): InvestmentFlowsCents => ({
  buyNotional: asCents(buyNotional),
  sellNotional: asCents(sellNotional),
  dividendsGross: asCents(dividendsGross),
  feesAndTaxes: asCents(feesAndTaxes),
});

/** Cents-branded holdings snapshot map keyed by date string. */
const holdings = (entries: Record<string, number>): Map<string, Cents> =>
  new Map(Object.entries(entries).map(([date, cents]): [string, Cents] => [date, asCents(cents)]));

describe('accumulateInvestmentFlows', () => {
  const boundaryDates = ['2025-12-31', '2026-01-31', '2026-02-28'];

  it('takes fees out of buy and sell notional', () => {
    // A $600 purchase with a $10 fee is stored as 610; a $200 sale with a $5 fee as 195.
    const flows = accumulateInvestmentFlows({
      transactions: [
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2026-01-10', amount: 610, fees: 10 }),
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.sell, date: '2026-01-20', amount: 195, fees: 5 }),
      ],
      boundaryDates,
    });

    expect(flows[0]).toEqual({
      buyNotional: 60_000,
      sellNotional: 20_000,
      dividendsGross: 0,
      feesAndTaxes: 1_500,
    });
  });

  it('counts dividends gross and their fee once', () => {
    const flows = accumulateInvestmentFlows({
      transactions: [
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.dividend, date: '2026-01-15', amount: 48, fees: 2 }),
      ],
      boundaryDates,
    });

    expect(flows[0]!.dividendsGross).toBe(5_000);
    expect(flows[0]!.feesAndTaxes).toBe(200);
  });

  it('counts a standalone fee or tax row once, at its full amount', () => {
    // A standalone fee row has no notional, so refAmount and refFees are the same value.
    const flows = accumulateInvestmentFlows({
      transactions: [
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.fee, date: '2026-01-05', amount: 12, fees: 12 }),
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.tax, date: '2026-01-06', amount: 30, fees: 0 }),
      ],
      boundaryDates,
    });

    expect(flows[0]!.feesAndTaxes).toBe(4_200);
  });

  it('ignores categories that move neither cash nor shares', () => {
    const flows = accumulateInvestmentFlows({
      transactions: [
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.transfer, date: '2026-01-10', amount: 5_000 }),
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.cancel, date: '2026-01-11', amount: 100 }),
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.other, date: '2026-01-12', amount: 100 }),
      ],
      boundaryDates,
    });

    expect(flows[0]).toEqual({ buyNotional: 0, sellNotional: 0, dividendsGross: 0, feesAndTaxes: 0 });
  });

  it('assigns each trade to the bucket whose holdings snapshots bracket it', () => {
    const flows = accumulateInvestmentFlows({
      transactions: [
        // The opening snapshot day itself already includes this trade, so it belongs to no bucket.
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2025-12-31', amount: 100 }),
        // First day the opening snapshot does not cover.
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2026-01-01', amount: 200 }),
        // Closing snapshot day of bucket 0.
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2026-01-31', amount: 400 }),
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2026-02-01', amount: 800 }),
        // Past the window.
        buildTx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2026-03-01', amount: 1_600 }),
      ],
      boundaryDates,
    });

    expect(flows[0]!.buyNotional).toBe(60_000);
    expect(flows[1]!.buyNotional).toBe(80_000);
  });

  it('returns a zeroed bucket per period when there are no transactions', () => {
    const flows = accumulateInvestmentFlows({ transactions: [], boundaryDates });

    expect(flows).toHaveLength(2);
    expect(flows[0]).toEqual({ buyNotional: 0, sellNotional: 0, dividendsGross: 0, feesAndTaxes: 0 });
  });
});

describe('computeInvestmentGrowth', () => {
  const boundaryDates = ['2025-12-31', '2026-01-31'];

  it('credits a pure price move to priceEffect', () => {
    // 10 shares held from $100 to $150.
    const [result] = computeInvestmentGrowth({
      flows: [flowsBucket()],
      holdingsCentsByDate: holdings({
        '2025-12-31': 100_000,
        '2026-01-31': 150_000,
      }),
      boundaryDates,
    });

    expect(result).toEqual({ growth: 50_000, priceEffect: 50_000, dividends: 0, feesAndTaxes: 0 });
  });

  it('excludes purchased value from growth', () => {
    // Start 10 shares at $100. Buy 5 at $120 mid-period. End price $150 -> 15 * $150 = $2,250.
    // Growth is the $50 gain on 10 held shares plus the $30 gain on 5 bought ones, not the $600 spent.
    const [result] = computeInvestmentGrowth({
      flows: [flowsBucket({ buyNotional: 60_000 })],
      holdingsCentsByDate: holdings({
        '2025-12-31': 100_000,
        '2026-01-31': 225_000,
      }),
      boundaryDates,
    });

    expect(result!.priceEffect).toBe(65_000);
    expect(result!.growth).toBe(65_000);
  });

  it('excludes sold value from growth', () => {
    // Sell everything at cost: holdings drain to zero but nothing was gained or lost.
    const [result] = computeInvestmentGrowth({
      flows: [flowsBucket({ sellNotional: 100_000 })],
      holdingsCentsByDate: holdings({
        '2025-12-31': 100_000,
        '2026-01-31': 0,
      }),
      boundaryDates,
    });

    expect(result!.growth).toBe(0);
  });

  it('adds dividends and subtracts fees and taxes', () => {
    const [result] = computeInvestmentGrowth({
      flows: [flowsBucket({ dividendsGross: 5_000, feesAndTaxes: 1_000 })],
      holdingsCentsByDate: holdings({
        '2025-12-31': 100_000,
        '2026-01-31': 150_000,
      }),
      boundaryDates,
    });

    expect(result).toEqual({ growth: 54_000, priceEffect: 50_000, dividends: 5_000, feesAndTaxes: 1_000 });
  });

  it('reports a losing period as negative growth', () => {
    const [result] = computeInvestmentGrowth({
      flows: [flowsBucket()],
      holdingsCentsByDate: holdings({
        '2025-12-31': 150_000,
        '2026-01-31': 100_000,
      }),
      boundaryDates,
    });

    expect(result!.growth).toBe(-50_000);
  });

  it('always re-adds its components to growth', () => {
    const [result] = computeInvestmentGrowth({
      flows: [flowsBucket({ buyNotional: 33_333, sellNotional: 11_111, dividendsGross: 777, feesAndTaxes: 999 })],
      holdingsCentsByDate: holdings({
        '2025-12-31': 123_456,
        '2026-01-31': 234_567,
      }),
      boundaryDates,
    });

    expect(result!.priceEffect + result!.dividends - result!.feesAndTaxes).toBe(result!.growth);
  });

  it('treats a period with no holdings on either side as zero growth', () => {
    const [result] = computeInvestmentGrowth({
      flows: [flowsBucket()],
      holdingsCentsByDate: holdings({}),
      boundaryDates,
    });

    expect(result).toEqual({ growth: 0, priceEffect: 0, dividends: 0, feesAndTaxes: 0 });
  });

  it('chains buckets so one bucket close is the next bucket open', () => {
    const results = computeInvestmentGrowth({
      flows: [flowsBucket(), flowsBucket()],
      holdingsCentsByDate: holdings({
        '2025-12-31': 100_000,
        '2026-01-31': 120_000,
        '2026-02-28': 90_000,
      }),
      boundaryDates: ['2025-12-31', '2026-01-31', '2026-02-28'],
    });

    expect(results[0]!.growth).toBe(20_000);
    expect(results[1]!.growth).toBe(-30_000);
    // No gap and no double count: the period growths sum to the whole-window move.
    expect(results[0]!.growth + results[1]!.growth).toBe(90_000 - 100_000);
  });

  it('books each gain once across a position rotation and the switch as a wash', () => {
    // A held at $10k rises to $12k (+$2k), is sold for $12k, and the proceeds are
    // rebought as B for $12k, which then rises to $15k (+$3k). Selling the already-
    // risen A books nothing new — its $2k was counted when the price moved — and the
    // sell-then-rebuy notionals cancel, so the rotation adds only the two price moves.
    const results = computeInvestmentGrowth({
      flows: [flowsBucket(), flowsBucket({ buyNotional: 1_200_000, sellNotional: 1_200_000 }), flowsBucket()],
      holdingsCentsByDate: holdings({
        '2025-12-31': 1_000_000,
        '2026-01-31': 1_200_000,
        '2026-02-28': 1_200_000,
        '2026-03-31': 1_500_000,
      }),
      boundaryDates: ['2025-12-31', '2026-01-31', '2026-02-28', '2026-03-31'],
    });

    expect(results[0]!.growth).toBe(200_000);
    // Recovered sale notional and spent purchase notional cancel: the switch is a wash.
    expect(results[1]!.growth).toBe(0);
    expect(results[2]!.growth).toBe(300_000);
    // The whole rotation books exactly the two price moves — $2k + $3k — and nothing else.
    expect(results[0]!.growth + results[1]!.growth + results[2]!.growth).toBe(500_000);
  });
});

describe('foldPortfolioGrowth', () => {
  /** One bucket of a portfolio's own growth series, defaulting each component to zero. */
  const growthBucket = ({
    growth = 0,
    priceEffect = 0,
    dividends = 0,
    feesAndTaxes = 0,
  }: Partial<Record<keyof InvestmentGrowthCents, number>> = {}): InvestmentGrowthCents => ({
    growth: asCents(growth),
    priceEffect: asCents(priceEffect),
    dividends: asCents(dividends),
    feesAndTaxes: asCents(feesAndTaxes),
  });

  const buildSeries = ({
    portfolioId,
    name,
    growth,
    hasActivity = true,
  }: {
    portfolioId: string;
    name: string;
    growth: InvestmentGrowthCents[];
    hasActivity?: boolean;
  }): PortfolioGrowthSeries => ({ portfolioId, name, growth, hasActivity });

  it('sums every component elementwise into the bucket totals', () => {
    const { totals } = foldPortfolioGrowth({
      series: [
        buildSeries({
          portfolioId: 'a',
          name: 'Alpha',
          growth: [growthBucket({ growth: 900, priceEffect: 1_000, dividends: 200, feesAndTaxes: 300 })],
        }),
        buildSeries({
          portfolioId: 'b',
          name: 'Beta',
          growth: [growthBucket({ growth: -150, priceEffect: -100, dividends: 0, feesAndTaxes: 50 })],
        }),
      ],
      bucketCount: 1,
    });

    expect(totals).toEqual([{ growth: 750, priceEffect: 900, dividends: 200, feesAndTaxes: 350 }]);
  });

  it('emits a slice only where a portfolio moved, and the slices re-add to the total', () => {
    const { totals, byBucket } = foldPortfolioGrowth({
      series: [
        buildSeries({
          portfolioId: 'a',
          name: 'Alpha',
          growth: [growthBucket({ growth: 500 }), growthBucket({ growth: -200 })],
        }),
        buildSeries({ portfolioId: 'b', name: 'Beta', growth: [growthBucket(), growthBucket({ growth: 700 })] }),
      ],
      bucketCount: 2,
    });

    // Beta sat out the first bucket, so it has no entry there rather than a zero one.
    expect(byBucket[0]).toEqual([{ portfolioId: 'a', growth: 500 }]);
    expect(byBucket[1]).toEqual([
      { portfolioId: 'a', growth: -200 },
      { portfolioId: 'b', growth: 700 },
    ]);
    expect(byBucket.map((slices) => slices.reduce((sum, slice) => sum + slice.growth, 0))).toEqual(
      totals.map((total) => total.growth),
    );
  });

  it('orders the legend by absolute total growth and breaks ties on name', () => {
    const { legend } = foldPortfolioGrowth({
      series: [
        buildSeries({ portfolioId: 'a', name: 'Zeta', growth: [growthBucket({ growth: 100 })] }),
        // A bigger loser outranks a smaller winner: the legend measures distance moved.
        buildSeries({ portfolioId: 'b', name: 'Beta', growth: [growthBucket({ growth: -400 })] }),
        buildSeries({ portfolioId: 'c', name: 'Alpha', growth: [growthBucket({ growth: -100 })] }),
      ],
      bucketCount: 1,
    });

    expect(legend).toEqual([
      { portfolioId: 'b', name: 'Beta' },
      { portfolioId: 'c', name: 'Alpha' },
      { portfolioId: 'a', name: 'Zeta' },
    ]);
  });

  it('keeps a flat-but-held portfolio in the legend and drops an inactive one', () => {
    const { legend } = foldPortfolioGrowth({
      series: [
        buildSeries({ portfolioId: 'held', name: 'Held', growth: [growthBucket()] }),
        buildSeries({ portfolioId: 'idle', name: 'Idle', growth: [growthBucket()], hasActivity: false }),
      ],
      bucketCount: 1,
    });

    expect(legend).toEqual([{ portfolioId: 'held', name: 'Held' }]);
  });
});
