import type { InvestmentTransactionModel } from '@bt/shared/types';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';

import {
  type PricePoint,
  type Trade,
  buildOpenLots,
  getBuyTiming,
  getTrades,
  groupTradesByDay,
  slicePricePoints,
  toPricePoints,
} from './holding-derivations';

const { buy, sell, dividend } = INVESTMENT_TRANSACTION_CATEGORY;

const trade = ({
  id,
  date,
  category = buy,
  quantity,
  price,
  fees = 0,
}: {
  id: string;
  date: string;
  category?: Trade['category'];
  quantity: number;
  price: number;
  fees?: number;
}): Trade => ({ id, date, category, quantity, price, fees });

const tx = ({
  id,
  date,
  category,
  quantity,
  price,
  createdAt = '2026-01-01T00:00:00.000Z',
}: {
  id: string;
  date: string;
  category: INVESTMENT_TRANSACTION_CATEGORY;
  quantity: number | null;
  price: number | null;
  createdAt?: string;
}) =>
  ({
    id,
    date,
    category,
    quantity: quantity === null ? null : String(quantity),
    price: price === null ? null : String(price),
    fees: '1',
    createdAt: new Date(createdAt),
  }) as unknown as InvestmentTransactionModel;

describe('toPricePoints', () => {
  it('sorts by day, keeps the UTC day and drops non-positive closes', () => {
    expect(
      toPricePoints({
        prices: [
          { date: '2026-11-20T00:00:00.000Z', priceClose: 12 },
          { date: '2026-11-18T00:00:00.000Z', priceClose: '10.5' },
          { date: '2026-11-19T00:00:00.000Z', priceClose: 0 },
        ],
      }),
    ).toEqual([
      { date: '2026-11-18', close: 10.5 },
      { date: '2026-11-20', close: 12 },
    ]);
  });

  it("keeps one point per UTC day, the day's latest price", () => {
    expect(
      toPricePoints({
        prices: [
          { date: '2026-11-18T23:00:00.000Z', priceClose: 11 },
          { date: '2026-11-19T01:00:00.000Z', priceClose: 20 },
          { date: '2026-11-18T01:00:00.000Z', priceClose: 10 },
          { date: '2026-11-18T12:00:00.000Z', priceClose: 15 },
        ],
      }),
    ).toEqual([
      { date: '2026-11-18', close: 11 },
      { date: '2026-11-19', close: 20 },
    ]);
  });

  it('skips rows with an invalid date instead of throwing', () => {
    expect(
      toPricePoints({
        prices: [
          { date: 'not-a-date', priceClose: 5 },
          { date: '2026-11-18T00:00:00.000Z', priceClose: 10 },
        ],
      }),
    ).toEqual([{ date: '2026-11-18', close: 10 }]);
  });
});

describe('slicePricePoints', () => {
  const points: PricePoint[] = [
    { date: '2025-06-01', close: 1 },
    { date: '2026-01-02', close: 2 },
    { date: '2026-10-30', close: 3 },
    { date: '2026-11-20', close: 4 },
  ];
  const today = new Date(2026, 10, 24);

  it('keeps everything for ALL', () => {
    expect(slicePricePoints({ points, period: 'ALL', today })).toHaveLength(4);
  });

  it('starts each period on its first day', () => {
    expect(slicePricePoints({ points, period: '1M', today }).map((p) => p.close)).toEqual([3, 4]);
    expect(slicePricePoints({ points, period: 'YTD', today }).map((p) => p.close)).toEqual([2, 3, 4]);
    expect(slicePricePoints({ points, period: '1Y', today }).map((p) => p.close)).toEqual([2, 3, 4]);
  });
});

describe('getTrades', () => {
  it('keeps priced buys and sells, oldest first with creation order breaking ties', () => {
    const trades = getTrades({
      transactions: [
        tx({
          id: 'sell',
          date: '2026-03-10T10:00:00Z',
          category: sell,
          quantity: 2,
          price: 30,
          createdAt: '2026-03-10T12:00:00Z',
        }),
        tx({
          id: 'buy-2',
          date: '2026-03-10T10:00:00Z',
          category: buy,
          quantity: 5,
          price: 20,
          createdAt: '2026-03-10T11:00:00Z',
        }),
        tx({ id: 'div', date: '2026-02-01T10:00:00Z', category: dividend, quantity: 0, price: 1 }),
        tx({ id: 'no-price', date: '2026-02-02T10:00:00Z', category: buy, quantity: 1, price: null }),
        tx({ id: 'buy-1', date: '2026-01-05T10:00:00Z', category: buy, quantity: 10, price: 10 }),
      ],
    });

    expect(trades.map((t) => t.id)).toEqual(['buy-1', 'buy-2', 'sell']);
    expect(trades[0]).toEqual({ id: 'buy-1', date: '2026-01-05', category: buy, quantity: 10, price: 10, fees: 1 });
  });

  it('dates a trade by its UTC day, the calendar of the price points', () => {
    const [late] = getTrades({
      transactions: [tx({ id: 'late', date: '2026-03-10T23:30:00Z', category: buy, quantity: 1, price: 10 })],
    });

    expect(late!.date).toBe('2026-03-10');
  });

  it('skips trades with an invalid date', () => {
    const trades = getTrades({
      transactions: [
        tx({ id: 'bad', date: 'garbage', category: buy, quantity: 1, price: 10 }),
        tx({ id: 'ok', date: '2026-03-10T10:00:00Z', category: buy, quantity: 1, price: 10 }),
      ],
    });

    expect(trades.map((t) => t.id)).toEqual(['ok']);
  });
});

describe('buildOpenLots', () => {
  it('consumes the oldest lots first and prices the rest at the current price', () => {
    const lots = buildOpenLots({
      trades: [
        trade({ id: 'a', date: '2026-01-01', quantity: 10, price: 10, fees: 10 }),
        trade({ id: 'b', date: '2026-02-01', quantity: 5, price: 20 }),
        trade({ id: 's', date: '2026-03-01', category: sell, quantity: 12, price: 25 }),
      ],
      price: 30,
    });

    expect(lots).toEqual([
      {
        id: 'b',
        date: '2026-02-01',
        quantity: 3,
        costPerShare: 20,
        costBasis: 60,
        marketValue: 90,
        gain: 30,
        gainPct: 0.5,
      },
    ]);
  });

  it('spreads buy fees into the cost per share', () => {
    const [lot] = buildOpenLots({
      trades: [trade({ id: 'a', date: '2026-01-01', quantity: 4, price: 10, fees: 2 })],
      price: 9,
    });

    expect(lot!.costPerShare).toBe(10.5);
    expect(lot!.gain).toBe(-6);
    expect(lot!.gainPct).toBeCloseTo(-6 / 42);
  });

  it('returns no lots when sells exceed buys or leave only float residue', () => {
    expect(
      buildOpenLots({
        trades: [
          trade({ id: 'a', date: '2026-01-01', quantity: 1, price: 10 }),
          trade({ id: 's', date: '2026-01-02', category: sell, quantity: 3, price: 10 }),
        ],
        price: 10,
      }),
    ).toEqual([]);
    expect(
      buildOpenLots({
        trades: [
          trade({ id: 'a', date: '2026-01-01', quantity: 0.1, price: 10 }),
          trade({ id: 'b', date: '2026-01-01', quantity: 0.2, price: 10 }),
          trade({ id: 's', date: '2026-01-02', category: sell, quantity: 0.3, price: 10 }),
        ],
        price: 10,
      }),
    ).toEqual([]);
  });

  it('starts a fresh lot for a buy after the position was closed', () => {
    const lots = buildOpenLots({
      trades: [
        trade({ id: 'a', date: '2026-01-01', quantity: 2, price: 10 }),
        trade({ id: 's', date: '2026-01-02', category: sell, quantity: 2, price: 12 }),
        trade({ id: 'b', date: '2026-01-03', quantity: 1, price: 11 }),
      ],
      price: 11,
    });

    expect(lots.map((lot) => [lot.id, lot.quantity])).toEqual([['b', 1]]);
  });

  it('lets later buys cover a short before opening a lot', () => {
    const sellFirst = [trade({ id: 's', date: '2026-01-01', category: sell, quantity: 5, price: 10 })];

    expect(
      buildOpenLots({
        trades: [...sellFirst, trade({ id: 'a', date: '2026-01-02', quantity: 5, price: 10 })],
        price: 10,
      }),
    ).toEqual([]);
    expect(
      buildOpenLots({
        trades: [...sellFirst, trade({ id: 'a', date: '2026-01-02', quantity: 8, price: 10 })],
        price: 10,
      }).map((lot) => [lot.id, lot.quantity]),
    ).toEqual([['a', 3]]);
  });

  it('leaves value and gain unknown without a price', () => {
    const [lot] = buildOpenLots({
      trades: [trade({ id: 'a', date: '2026-01-01', quantity: 2, price: 10 })],
      price: null,
    });

    expect(lot).toMatchObject({ costBasis: 20, marketValue: null, gain: null, gainPct: null });
  });

  it('has no gain percentage for a zero-cost lot', () => {
    const [lot] = buildOpenLots({ trades: [trade({ id: 'a', date: '2026-01-01', quantity: 2, price: 0 })], price: 5 });

    expect(lot).toMatchObject({ gain: 10, gainPct: null });
  });
});

describe('getBuyTiming', () => {
  const closes = (entries: [string, number][]): PricePoint[] => entries.map(([date, close]) => ({ date, close }));
  const history = closes([
    ['2026-01-01', 100],
    ['2026-01-02', 90],
    ['2026-01-05', 110],
    ['2026-01-06', 100],
    ['2026-01-07', 120],
    ['2026-01-08', 80],
  ]);

  it('compares the quantity-weighted buy price with the mean close since the first buy', () => {
    const timing = getBuyTiming({
      trades: [
        trade({ id: 'a', date: '2026-01-02', quantity: 3, price: 90 }),
        trade({ id: 's', date: '2026-01-05', category: sell, quantity: 1, price: 200 }),
        trade({ id: 'b', date: '2026-01-06', quantity: 1, price: 106 }),
      ],
      points: history,
    });

    expect(timing).toMatchObject({ averageBuyPrice: 94, averageClose: 100, firstBuyDate: '2026-01-02' });
    expect(timing!.difference).toBeCloseTo(-0.06);
  });

  it('is null without buys', () => {
    expect(getBuyTiming({ trades: [], points: history })).toBeNull();
  });

  it('is null when the history starts well after the first buy', () => {
    expect(
      getBuyTiming({ trades: [trade({ id: 'a', date: '2025-12-01', quantity: 1, price: 90 })], points: history }),
    ).toBeNull();
  });

  it('accepts a history that starts up to a week after the first buy', () => {
    expect(
      getBuyTiming({ trades: [trade({ id: 'a', date: '2025-12-25', quantity: 1, price: 90 })], points: history }),
    ).not.toBeNull();
    expect(
      getBuyTiming({ trades: [trade({ id: 'a', date: '2025-12-24', quantity: 1, price: 90 })], points: history }),
    ).toBeNull();
  });

  it('needs at least five closes since the first buy', () => {
    expect(
      getBuyTiming({ trades: [trade({ id: 'a', date: '2026-01-02', quantity: 1, price: 90 })], points: history }),
    ).not.toBeNull();
    expect(
      getBuyTiming({ trades: [trade({ id: 'a', date: '2026-01-05', quantity: 1, price: 90 })], points: history }),
    ).toBeNull();
  });

  it('is null with too few closes since the first buy', () => {
    expect(
      getBuyTiming({ trades: [trade({ id: 'a', date: '2026-01-06', quantity: 1, price: 90 })], points: history }),
    ).toBeNull();
  });
});

describe('groupTradesByDay', () => {
  it('merges same-day buys into one entry priced at the quantity-weighted average', () => {
    const [day, ...rest] = groupTradesByDay({
      trades: [
        trade({ id: 'a', date: '2026-03-02', quantity: 4, price: 300 }),
        trade({ id: 'b', date: '2026-03-02', quantity: 6, price: 310 }),
      ],
    });
    expect(rest).toEqual([]);
    expect(day).toMatchObject({ date: '2026-03-02', kind: 'buy', quantity: 10, soldAmount: 0 });
    expect(day!.trades.map((t) => t.id)).toEqual(['a', 'b']);
    expect(day!.averagePrice).toBeCloseTo(306);
    expect(day!.boughtAmount).toBeCloseTo(3060);
  });

  it('marks a day with a buy and a sell as both and splits the amounts', () => {
    const [day] = groupTradesByDay({
      trades: [
        trade({ id: 'a', date: '2026-03-02', category: sell, quantity: 103, price: 280.7 }),
        trade({ id: 'b', date: '2026-03-02', quantity: 103, price: 280.9 }),
      ],
    });
    expect(day).toMatchObject({ kind: 'both', quantity: 206 });
    expect(day!.averagePrice).toBeCloseTo(280.8);
    expect(day!.boughtAmount).toBeCloseTo(103 * 280.9);
    expect(day!.soldAmount).toBeCloseTo(103 * 280.7);
  });

  it('keeps different days apart in input order', () => {
    expect(
      groupTradesByDay({
        trades: [
          trade({ id: 'a', date: '2026-03-02', quantity: 1, price: 10 }),
          trade({ id: 'b', date: '2026-03-03', category: sell, quantity: 1, price: 12 }),
        ],
      }).map(({ date, kind }) => ({ date, kind })),
    ).toEqual([
      { date: '2026-03-02', kind: 'buy' },
      { date: '2026-03-03', kind: 'sell' },
    ]);
  });

  it('returns nothing without trades', () => {
    expect(groupTradesByDay({ trades: [] })).toEqual([]);
  });
});
