import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import type { CategoryRefundPair } from '@services/stats/category-allocation';
import type { PeriodBucket } from '@services/stats/utils';

import { accumulateSavings } from './savings';

const buildBucket = ({ start, end }: { start: string; end: string }): PeriodBucket => ({
  periodStart: new Date(`${start}T00:00:00.000`),
  periodEnd: new Date(`${end}T23:59:59.999`),
});

const buildTx = ({
  time,
  amount,
  transactionType,
}: {
  time: string;
  /** Decimal, as the caller's query hands it over. */
  amount: number;
  transactionType: TRANSACTION_TYPES;
}) => ({
  time: new Date(time),
  refAmount: Money.fromDecimal(amount),
  transactionType,
});

const buildPair = ({
  expenseTime,
  incomeTime,
  cents,
  expenseInScope = true,
  incomeInScope = true,
}: {
  expenseTime: string;
  incomeTime: string;
  cents: number;
  expenseInScope?: boolean;
  incomeInScope?: boolean;
}): CategoryRefundPair => ({
  cents,
  expenseTime: new Date(expenseTime),
  incomeTime: new Date(incomeTime),
  expenseCategoryId: 'cat-expense',
  incomeCategoryId: 'cat-income',
  expenseInScope,
  incomeInScope,
});

const JAN = buildBucket({ start: '2026-01-01', end: '2026-01-31' });
const FEB = buildBucket({ start: '2026-02-01', end: '2026-02-28' });
const buckets = [JAN, FEB];

describe('accumulateSavings', () => {
  it('sums income and expenses into their bucket', () => {
    const savings = accumulateSavings({
      transactions: [
        buildTx({ time: '2026-01-10T12:00:00.000', amount: 500, transactionType: TRANSACTION_TYPES.income }),
        buildTx({ time: '2026-01-20T12:00:00.000', amount: 200, transactionType: TRANSACTION_TYPES.expense }),
        buildTx({ time: '2026-02-05T12:00:00.000', amount: 300, transactionType: TRANSACTION_TYPES.income }),
      ],
      buckets,
    });

    expect(savings[0]).toEqual({ income: 50_000, expenses: 20_000, net: 30_000 });
    expect(savings[1]).toEqual({ income: 30_000, expenses: 0, net: 30_000 });
  });

  it('keeps expenses positive and nets them out of income', () => {
    // Expenses accumulate as a positive magnitude, matching get-cash-flow — only
    // `net` carries the direction.
    const [january] = accumulateSavings({
      transactions: [
        buildTx({ time: '2026-01-10T12:00:00.000', amount: 80, transactionType: TRANSACTION_TYPES.expense }),
      ],
      buckets,
    });

    expect(january).toEqual({ income: 0, expenses: 8_000, net: -8_000 });
  });

  it('reports an overspent bucket as negative net', () => {
    const [january] = accumulateSavings({
      transactions: [
        buildTx({ time: '2026-01-10T12:00:00.000', amount: 100, transactionType: TRANSACTION_TYPES.income }),
        buildTx({ time: '2026-01-11T12:00:00.000', amount: 450, transactionType: TRANSACTION_TYPES.expense }),
      ],
      buckets,
    });

    expect(january!.net).toBe(-35_000);
  });

  it('counts transactions on either bucket edge', () => {
    const savings = accumulateSavings({
      transactions: [
        buildTx({ time: '2026-01-01T00:00:00.000', amount: 10, transactionType: TRANSACTION_TYPES.income }),
        buildTx({ time: '2026-01-31T23:59:59.999', amount: 20, transactionType: TRANSACTION_TYPES.income }),
      ],
      buckets,
    });

    expect(savings[0]!.income).toBe(3_000);
  });

  it('ignores transactions outside every bucket', () => {
    const savings = accumulateSavings({
      transactions: [
        buildTx({ time: '2025-12-31T12:00:00.000', amount: 999, transactionType: TRANSACTION_TYPES.income }),
        buildTx({ time: '2026-03-01T12:00:00.000', amount: 999, transactionType: TRANSACTION_TYPES.income }),
      ],
      buckets,
    });

    expect(savings).toEqual([
      { income: 0, expenses: 0, net: 0 },
      { income: 0, expenses: 0, net: 0 },
    ]);
  });

  it('returns a zeroed entry per bucket when there are no transactions', () => {
    const savings = accumulateSavings({ transactions: [], buckets });

    expect(savings).toHaveLength(2);
    expect(savings[0]).toEqual({ income: 0, expenses: 0, net: 0 });
  });

  it('returns nothing when there are no buckets', () => {
    expect(accumulateSavings({ transactions: [], buckets: [] })).toEqual([]);
  });
});

describe('accumulateSavings refund netting', () => {
  const spendAndRefund = [
    buildTx({ time: '2026-01-05T12:00:00.000', amount: 300, transactionType: TRANSACTION_TYPES.expense }),
    buildTx({ time: '2026-01-20T12:00:00.000', amount: 120, transactionType: TRANSACTION_TYPES.income }),
  ];
  const sameMonthPair = {
    expenseTime: '2026-01-05T12:00:00.000',
    incomeTime: '2026-01-20T12:00:00.000',
    cents: 12_000,
  };

  it('subtracts a fully in-scope pair from both sides', () => {
    const [january] = accumulateSavings({
      transactions: spendAndRefund,
      buckets,
      refundPairs: [buildPair(sameMonthPair)],
    });

    expect(january).toEqual({ income: 0, expenses: 18_000, net: -18_000 });
  });

  it('nets only the income side when the expense half is out of scope', () => {
    const [january] = accumulateSavings({
      transactions: spendAndRefund,
      buckets,
      refundPairs: [buildPair({ ...sameMonthPair, expenseInScope: false })],
    });

    expect(january).toEqual({ income: 0, expenses: 30_000, net: -30_000 });
  });

  it('nets only the expense side when the income half is out of scope', () => {
    const [january] = accumulateSavings({
      transactions: spendAndRefund,
      buckets,
      refundPairs: [buildPair({ ...sameMonthPair, incomeInScope: false })],
    });

    expect(january).toEqual({ income: 12_000, expenses: 18_000, net: -6_000 });
  });

  it('nets each side in its own bucket', () => {
    const savings = accumulateSavings({
      transactions: [
        buildTx({ time: '2026-01-05T12:00:00.000', amount: 300, transactionType: TRANSACTION_TYPES.expense }),
        buildTx({ time: '2026-02-03T12:00:00.000', amount: 200, transactionType: TRANSACTION_TYPES.expense }),
        buildTx({ time: '2026-02-10T12:00:00.000', amount: 120, transactionType: TRANSACTION_TYPES.income }),
      ],
      buckets,
      refundPairs: [
        buildPair({ expenseTime: '2026-01-05T12:00:00.000', incomeTime: '2026-02-10T12:00:00.000', cents: 12_000 }),
      ],
    });

    expect(savings[0]).toEqual({ income: 0, expenses: 18_000, net: -18_000 });
    expect(savings[1]).toEqual({ income: 0, expenses: 20_000, net: -20_000 });
  });

  it('ignores a side dated outside every bucket', () => {
    const [january] = accumulateSavings({
      transactions: spendAndRefund,
      buckets,
      refundPairs: [buildPair({ ...sameMonthPair, expenseTime: '2025-12-20T12:00:00.000' })],
    });

    expect(january).toEqual({ income: 0, expenses: 30_000, net: -30_000 });
  });
});
