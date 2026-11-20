import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// The engine only needs the three models as call targets; stubbing them keeps this run free of the
// database connection their real import graph opens.
jest.mock('@models/refund-transactions.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@models/transaction-splits.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@models/transactions-query', () => ({ __esModule: true, findTransactions: jest.fn() }));

/* eslint-disable import/first */
import RefundTransactions from '@models/refund-transactions.model';
import TransactionSplits from '@models/transaction-splits.model';

import { computeCategoryAllocations, resolveRefundPairs } from './category-allocation';
/* eslint-enable import/first */

const splitsFindAll = jest.mocked(TransactionSplits.findAll) as unknown as jest.Mock<() => Promise<unknown[]>>;
const refundsFindAll = jest.mocked(RefundTransactions.findAll) as unknown as jest.Mock<() => Promise<unknown[]>>;

const buildTransaction = ({
  id,
  refAmount,
  categoryId = 'cat-a',
  transactionType = TRANSACTION_TYPES.expense,
  refundLinked = false,
}: {
  id: string;
  refAmount: string;
  categoryId?: string;
  transactionType?: TRANSACTION_TYPES;
  refundLinked?: boolean;
}) => ({
  id,
  amount: Money.fromDecimal(refAmount),
  refAmount: Money.fromDecimal(refAmount),
  categoryId,
  transactionType,
  time: '2026-01-10T12:00:00.000Z',
  refundLinked,
});

beforeEach(() => {
  jest.clearAllMocks();
  splitsFindAll.mockResolvedValue([]);
  refundsFindAll.mockResolvedValue([]);
});

describe('computeCategoryAllocations minor units', () => {
  it.each([
    [3, '1.234', 1234],
    [2, '1.234', 123],
    [0, '1500', 1500],
  ])('converts at %s decimals: %s -> %s minor units', async (decimals, refAmount, minor) => {
    const { base } = await computeCategoryAllocations({
      transactions: [buildTransaction({ id: 'tx-1', refAmount })],
      applyRefunds: false,
      decimals,
    });

    expect(base.map((leg) => leg.minor)).toEqual([minor]);
  });

  it('gives the primary category what the splits leave at 3 decimals', async () => {
    splitsFindAll.mockResolvedValue([
      { id: 'split-1', transactionId: 'tx-1', categoryId: 'cat-b', refAmount: Money.fromDecimal('0.5') },
    ]);

    const { base } = await computeCategoryAllocations({
      transactions: [buildTransaction({ id: 'tx-1', refAmount: '1.234' })],
      applyRefunds: false,
      decimals: 3,
    });

    expect(base).toEqual([
      expect.objectContaining({ categoryId: 'cat-a', minor: 734 }),
      expect.objectContaining({ categoryId: 'cat-b', minor: 500 }),
    ]);
  });
});

describe('resolveRefundPairs minor units', () => {
  it('reports the refund magnitude with its third decimal', async () => {
    refundsFindAll.mockResolvedValue([
      { originalTxId: 'tx-1', refundTxId: 'tx-2', splitId: null, userId: 1, amount: null },
    ]);

    const pairs = await resolveRefundPairs({
      transactions: [
        buildTransaction({ id: 'tx-1', refAmount: '1.234', refundLinked: true }),
        buildTransaction({
          id: 'tx-2',
          refAmount: '0.778',
          categoryId: 'cat-b',
          transactionType: TRANSACTION_TYPES.income,
          refundLinked: true,
        }),
      ],
      decimals: 3,
    });

    expect(pairs).toEqual([
      expect.objectContaining({ minor: 778, expenseCategoryId: 'cat-a', incomeCategoryId: 'cat-b' }),
    ]);
  });
});

describe('resolveRefundPairs partial links', () => {
  it('rounds the linked share of the refund to the third decimal', async () => {
    // 1 of the refund's 3 native units links to the expense: 1.001 * 1 / 3 = 0.33366..., which
    // rounds half-up to 0.334 at 3 decimals.
    refundsFindAll.mockResolvedValue([
      { originalTxId: 'tx-1', refundTxId: 'tx-2', splitId: null, userId: 1, amount: Money.fromDecimal('1') },
    ]);

    const pairs = await resolveRefundPairs({
      transactions: [
        buildTransaction({ id: 'tx-1', refAmount: '1.234', refundLinked: true }),
        {
          ...buildTransaction({
            id: 'tx-2',
            refAmount: '1.001',
            categoryId: 'cat-b',
            transactionType: TRANSACTION_TYPES.income,
            refundLinked: true,
          }),
          amount: Money.fromDecimal('3'),
        },
      ],
      decimals: 3,
    });

    expect(pairs).toEqual([
      expect.objectContaining({ minor: 334, expenseCategoryId: 'cat-a', incomeCategoryId: 'cat-b' }),
    ]);
  });
});
