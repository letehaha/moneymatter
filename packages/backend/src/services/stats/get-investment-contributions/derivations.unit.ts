import { TRANSACTION_TYPES, asMinorUnits } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';
import { generatePeriodBuckets } from '@services/stats/utils';

import { accumulateContributions, accumulateSavingsNet, orderLegend } from './derivations';

// Three monthly buckets in the past: Jan, Feb, Mar. The unit runner pins TZ=UTC,
// so `new Date('2026-01-01')` and the transfer DATEONLY strings share the exact
// midnight-UTC basis the bucket edges are built on.
const buckets = generatePeriodBuckets({ from: '2026-01-01', to: '2026-03-31', granularity: 'monthly' });

describe('accumulateContributions', () => {
  it('counts an inbound deposit as a positive delta', () => {
    const { byBucket, activePortfolioIds } = accumulateContributions({
      transfers: [
        { fromPortfolioId: null, toPortfolioId: 'p1', refAmountMinor: asMinorUnits(50_000), date: '2026-01-15' },
      ],
      buckets,
      scope: new Set(['p1']),
    });

    expect(byBucket[0]!.get('p1')).toBe(50_000);
    expect(activePortfolioIds.has('p1')).toBe(true);
  });

  it('counts an outbound withdrawal as a negative delta', () => {
    const { byBucket, activePortfolioIds } = accumulateContributions({
      transfers: [
        { fromPortfolioId: 'p1', toPortfolioId: null, refAmountMinor: asMinorUnits(30_000), date: '2026-01-15' },
      ],
      buckets,
      scope: new Set(['p1']),
    });

    expect(byBucket[0]!.get('p1')).toBe(-30_000);
    expect(activePortfolioIds.has('p1')).toBe(true);
  });

  it('skips a portfolio-to-portfolio transfer that names both sides', () => {
    const { byBucket, activePortfolioIds } = accumulateContributions({
      transfers: [
        { fromPortfolioId: 'p1', toPortfolioId: 'p2', refAmountMinor: asMinorUnits(20_000), date: '2026-01-15' },
      ],
      buckets,
      scope: new Set(['p1', 'p2']),
    });

    expect(byBucket[0]!.size).toBe(0);
    expect(activePortfolioIds.size).toBe(0);
  });

  it('skips a transfer whose only portfolio is out of scope', () => {
    const { byBucket, activePortfolioIds } = accumulateContributions({
      transfers: [
        { fromPortfolioId: null, toPortfolioId: 'pX', refAmountMinor: asMinorUnits(10_000), date: '2026-01-15' },
      ],
      buckets,
      scope: new Set(['p1']),
    });

    expect(byBucket[0]!.size).toBe(0);
    expect(activePortfolioIds.size).toBe(0);
  });

  it('buckets a Jan 31 transfer into January and a Feb 1 transfer into February', () => {
    const { byBucket } = accumulateContributions({
      transfers: [
        { fromPortfolioId: null, toPortfolioId: 'p1', refAmountMinor: asMinorUnits(11_100), date: '2026-01-31' },
        { fromPortfolioId: null, toPortfolioId: 'p1', refAmountMinor: asMinorUnits(22_200), date: '2026-02-01' },
      ],
      buckets,
      scope: new Set(['p1']),
    });

    expect(byBucket[0]!.get('p1')).toBe(11_100);
    expect(byBucket[1]!.get('p1')).toBe(22_200);
  });

  it('drops a portfolio whose deposit and withdrawal cancel within a bucket', () => {
    const { byBucket, activePortfolioIds } = accumulateContributions({
      transfers: [
        { fromPortfolioId: null, toPortfolioId: 'p1', refAmountMinor: asMinorUnits(40_000), date: '2026-01-10' },
        { fromPortfolioId: 'p1', toPortfolioId: null, refAmountMinor: asMinorUnits(40_000), date: '2026-01-20' },
      ],
      buckets,
      scope: new Set(['p1']),
    });

    expect(byBucket[0]!.get('p1')).toBe(0);
    expect(activePortfolioIds.has('p1')).toBe(false);
  });
});

describe('accumulateSavingsNet', () => {
  it('nets income minus expense per bucket', () => {
    const savingsNet = accumulateSavingsNet({
      decimals: 2,
      transactions: [
        {
          time: '2026-01-10T12:00:00.000Z',
          refAmount: Money.fromCents(50_000),
          transactionType: TRANSACTION_TYPES.income,
        },
        {
          time: '2026-01-20T12:00:00.000Z',
          refAmount: Money.fromCents(20_000),
          transactionType: TRANSACTION_TYPES.expense,
        },
        {
          time: '2026-02-05T12:00:00.000Z',
          refAmount: Money.fromCents(30_000),
          transactionType: TRANSACTION_TYPES.expense,
        },
      ],
      buckets,
    });

    expect(savingsNet[0]).toBe(30_000);
    expect(savingsNet[1]).toBe(-30_000);
    expect(savingsNet[2]).toBe(0);
  });

  it('ignores transactions outside every bucket', () => {
    const savingsNet = accumulateSavingsNet({
      decimals: 2,
      transactions: [
        {
          time: '2025-12-31T12:00:00.000Z',
          refAmount: Money.fromCents(99_900),
          transactionType: TRANSACTION_TYPES.income,
        },
      ],
      buckets,
    });

    expect(savingsNet).toEqual([0, 0, 0]);
  });

  it('keeps the third decimal of a 3-decimal base currency', () => {
    const savingsNet = accumulateSavingsNet({
      decimals: 3,
      transactions: [
        {
          time: '2026-01-10T12:00:00.000Z',
          refAmount: Money.fromDecimal(0.778),
          transactionType: TRANSACTION_TYPES.income,
        },
        {
          time: '2026-01-20T12:00:00.000Z',
          refAmount: Money.fromDecimal(1.234),
          transactionType: TRANSACTION_TYPES.expense,
        },
      ],
      buckets,
    });

    expect(savingsNet[0]).toBe(-456);
  });
});

describe('orderLegend', () => {
  it('orders by absolute signed total desc, breaks ties on name, and drops inactive portfolios', () => {
    const byBucket = [
      new Map([
        ['p1', asMinorUnits(30_000)],
        ['p2', asMinorUnits(-50_000)],
        ['pA', asMinorUnits(20_000)],
        ['pB', asMinorUnits(20_000)],
        ['p3', asMinorUnits(40_000)],
      ]),
      // p3 cancels to zero across the window, so it is not in `activePortfolioIds`.
      new Map([['p3', asMinorUnits(-40_000)]]),
    ];

    const legend = orderLegend({
      byBucket,
      activePortfolioIds: new Set(['p1', 'p2', 'pA', 'pB']),
      nameById: new Map([
        ['p1', 'One'],
        ['p2', 'Two'],
        ['pA', 'Bravo'],
        ['pB', 'Alpha'],
      ]),
    });

    // |p2|=50k, |p1|=30k, then pA and pB tie at 20k -> Alpha (pB) before Bravo (pA).
    expect(legend.map((entry) => entry.portfolioId)).toEqual(['p2', 'p1', 'pB', 'pA']);
    expect(legend.find((entry) => entry.portfolioId === 'p3')).toBeUndefined();
  });
});
