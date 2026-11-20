import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { computeHoldingsValueByDate } from './holdings-replay';
import type { SecurityRow, TransactionRow } from './types';

// `TransactionRow` mirrors a `raw: true` query result, so DECIMAL fields are
// plain strings here, exactly as the pg driver returns them.
const tx = ({
  portfolioId = 'p1',
  securityId = 'sec-1',
  category,
  date,
  quantity,
  refAmount,
  currencyCode = 'USD',
}: {
  portfolioId?: string;
  securityId?: string;
  category: INVESTMENT_TRANSACTION_CATEGORY;
  date: string;
  quantity: number;
  refAmount: number;
  currencyCode?: string;
}): TransactionRow =>
  // Cast launders the `RecordId` brand on the fixture ids.
  ({
    portfolioId,
    securityId,
    category,
    date: new Date(`${date}T00:00:00Z`),
    quantity: String(quantity),
    refAmount: String(refAmount),
    currencyCode,
    settlementAmount: String(refAmount),
    settlementCurrencyCode: currencyCode,
  }) as unknown as TransactionRow;

const stockSecurity = (id: string, currencyCode = 'USD'): SecurityRow =>
  ({ id, currencyCode, assetClass: ASSET_CLASS.stocks }) as unknown as SecurityRow;

const cryptoSecurity = (id: string, currencyCode = 'USD'): SecurityRow =>
  ({ id, currencyCode, assetClass: ASSET_CLASS.crypto }) as unknown as SecurityRow;

const groupByPortfolio = (transactions: TransactionRow[]): Map<string, TransactionRow[]> => {
  const map = new Map<string, TransactionRow[]>();
  for (const t of transactions) {
    if (!map.has(t.portfolioId)) map.set(t.portfolioId, []);
    map.get(t.portfolioId)!.push(t);
  }
  return map;
};

const securityMap = (...rows: SecurityRow[]): Map<string, SecurityRow> => new Map(rows.map((s) => [s.id, s]));

const noopRate = () => 1;

describe('computeHoldingsValueByDate', () => {
  it('returns an empty map when uniqueDates is empty', () => {
    const result = computeHoldingsValueByDate({
      uniqueDates: [],
      portfolioIds: ['p1'],
      transactionsByPortfolio: new Map(),
      securitiesById: new Map(),
      findPriceForDate: () => 100,
      getExchangeRate: noopRate,
    });
    expect(result.size).toBe(0);
  });

  it('emits zero for every day when the portfolio has no transactions', () => {
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10', '2024-05-11'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: new Map(),
      securitiesById: new Map(),
      findPriceForDate: () => 100,
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(0);
    expect(result.get('2024-05-11')).toBe(0);
  });

  it('floors each holding to a whole unit by default and keeps decimals with floorValues: false', () => {
    const run = (floorValues?: boolean) =>
      computeHoldingsValueByDate({
        uniqueDates: ['2024-05-10'],
        portfolioIds: ['p1'],
        transactionsByPortfolio: groupByPortfolio([
          tx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2024-05-09', quantity: 10, refAmount: 1000 }),
        ]),
        securitiesById: securityMap(stockSecurity('sec-1')),
        findPriceForDate: () => 110.55,
        getExchangeRate: noopRate,
        floorValues,
      }).get('2024-05-10');

    expect(run()).toBe(1105);
    expect(run(false)).toBeCloseTo(1105.5, 6);
  });

  it('values a long position at market price * quantity * rate (floored)', () => {
    // 10 shares bought on day -1 at refAmount 1000; price 110 on day 0; rate 1.
    // Market value = 10 * 110 * 1 = 1100.
    const transactions = [
      tx({
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        date: '2024-05-09',
        quantity: 10,
        refAmount: 1000,
      }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => 110,
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(1100);
  });

  it('falls back to cost basis when no price exists on or before the snapshot date', () => {
    // 5 shares bought for 500 (no fees). No price → costBasis 500.
    const transactions = [
      tx({
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        date: '2024-05-09',
        quantity: 5,
        refAmount: 500,
      }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => null,
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(500);
  });

  it('reports each unpriced holding-day through onMissingPrice', () => {
    // A held position with no price on the snapshot day falls back to cost basis and
    // must announce the gap so the report can flag the day as partly unpriced. It
    // fires once per (security, day), not once per security.
    const transactions = [
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2024-05-09', quantity: 5, refAmount: 500 }),
    ];
    const missing: { securityId: string; dateStr: string }[] = [];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10', '2024-05-11'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => null,
      getExchangeRate: noopRate,
      onMissingPrice: (info) => missing.push(info),
    });
    expect(result.get('2024-05-10')).toBe(500);
    expect(missing).toEqual([
      { securityId: 'sec-1', dateStr: '2024-05-10' },
      { securityId: 'sec-1', dateStr: '2024-05-11' },
    ]);
  });

  it('does not call onMissingPrice when every holding-day is priced', () => {
    const transactions = [
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2024-05-09', quantity: 5, refAmount: 500 }),
    ];
    const missing: { securityId: string; dateStr: string }[] = [];
    computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => 110,
      getExchangeRate: noopRate,
      onMissingPrice: (info) => missing.push(info),
    });
    expect(missing).toEqual([]);
  });

  it('skips transactions dated after the snapshot day', () => {
    // Buy on 2024-05-11 must not contribute to 2024-05-10's value.
    const transactions = [
      tx({
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        date: '2024-05-11',
        quantity: 10,
        refAmount: 1000,
      }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10', '2024-05-11'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => 110,
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(0);
    expect(result.get('2024-05-11')).toBe(1100);
  });

  it('reduces cost basis proportionally on a partial sell and zeroes it when the long position closes', () => {
    // Buy 5 @ 100 (refAmount 500). Sell 2 @ 120 (refAmount 240). After sell:
    // qty = 3, costBasis = 500 * (3/5) = 300. With price=120, market value = 3*120=360.
    // Sell remaining 3 @ 120 (refAmount 360). After: qty=0, costBasis=0.
    const transactions = [
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2024-05-09', quantity: 5, refAmount: 500 }),
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.sell, date: '2024-05-10', quantity: 2, refAmount: 240 }),
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.sell, date: '2024-05-11', quantity: 3, refAmount: 360 }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10', '2024-05-11'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => 120,
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(360);
    expect(result.get('2024-05-11')).toBe(0);
  });

  it('on a buy that crosses from short to long, only the long portion contributes to cost basis', () => {
    // Start with no position, sell 5 (short -5 with qty=0 before — sell branch
    // requires holding.quantity > 0 to adjust costBasis, so a sell on a flat
    // book just makes quantity negative without changing costBasis).
    // Then buy 8 with refAmount 400. New qty = -5 + 8 = 3 (long).
    // longProportion = 3/8 = 0.375. costBasis = 400 * 0.375 = 150.
    // Day 11 price 100 → market value = 3 * 100 = 300, floored to 300.
    const transactions = [
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.sell, date: '2024-05-09', quantity: 5, refAmount: 0 }),
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2024-05-10', quantity: 8, refAmount: 400 }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10', '2024-05-11'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => 100,
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(300);

    // Now with no price, fall back to costBasis = 150.
    const fallback = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => null,
      getExchangeRate: noopRate,
    });
    expect(fallback.get('2024-05-10')).toBe(150);
  });

  it('on a buy whose new quantity stays at or below zero, cost basis is set to zero', () => {
    // qty=0; sell 5 → qty=-5, costBasis untouched (sell branch demands long).
    // buy 3 → newQuantity = -5 + 3 = -2 (still short). Branch sets costBasis=0.
    const transactions = [
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.sell, date: '2024-05-09', quantity: 5, refAmount: 0 }),
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2024-05-10', quantity: 3, refAmount: 150 }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      // Stocks cap at zero for negative quantities → no contribution.
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => 100,
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(0);
  });

  it('crypto allows negative quantity to flow into market value (drift until reconciled)', () => {
    // Crypto holding sold short (qty -2) with price 1000. -2 * 1000 * 1 = -2000.
    const transactions = [
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.sell, date: '2024-05-09', quantity: 2, refAmount: 0 }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(cryptoSecurity('sec-1')),
      findPriceForDate: () => 1000,
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(-2000);
  });

  it('stocks do NOT contribute when the quantity has drifted negative (capped at zero)', () => {
    const transactions = [
      tx({ category: INVESTMENT_TRANSACTION_CATEGORY.sell, date: '2024-05-09', quantity: 2, refAmount: 0 }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => 1000,
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(0);
  });

  it('folds refAmount alone into cost basis, with no separate fee added on top', () => {
    // `resolveSettlement` composes refAmount as quantity * price *including*
    // fees, so a 1000 principal + 50 fee buy carries refAmount 1050. Cost basis
    // must be that 1050 alone; adding the fee again would inflate it to 1100
    // (which is why `refFees` is not even part of the projected row).
    const transactions = [
      tx({
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        date: '2024-05-09',
        quantity: 10,
        refAmount: 1050,
      }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1')),
      findPriceForDate: () => null, // forces costBasis fallback
      getExchangeRate: noopRate,
    });
    expect(result.get('2024-05-10')).toBe(1050);
  });

  it('applies the security currency rate when converting market value, not the cash-leg currency', () => {
    // EUR-denominated security, 1 share at price 100, rate 2 → value 200.
    const transactions = [
      tx({
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        date: '2024-05-09',
        quantity: 1,
        refAmount: 100,
        currencyCode: 'USD', // settlement currency; should NOT drive the FX
      }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1', 'EUR')),
      findPriceForDate: () => 100,
      getExchangeRate: (currencyCode) => (currencyCode === 'EUR' ? 2 : 1),
    });
    expect(result.get('2024-05-10')).toBe(200);
  });

  it('sums holdings across multiple portfolios on the same day', () => {
    const transactions = [
      tx({
        portfolioId: 'p1',
        securityId: 'sec-1',
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        date: '2024-05-09',
        quantity: 5,
        refAmount: 500,
      }),
      tx({
        portfolioId: 'p2',
        securityId: 'sec-2',
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        date: '2024-05-09',
        quantity: 10,
        refAmount: 100,
      }),
    ];
    const result = computeHoldingsValueByDate({
      uniqueDates: ['2024-05-10'],
      portfolioIds: ['p1', 'p2'],
      transactionsByPortfolio: groupByPortfolio(transactions),
      securitiesById: securityMap(stockSecurity('sec-1'), stockSecurity('sec-2')),
      findPriceForDate: (id) => (id === 'sec-1' ? 110 : 12),
      getExchangeRate: noopRate,
    });
    // p1: 5 * 110 = 550. p2: 10 * 12 = 120. Total 670.
    expect(result.get('2024-05-10')).toBe(670);
  });
});
