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
  it('keeps the third decimal of a KWD amount', async () => {
    const { base } = await computeCategoryAllocations({
      transactions: [buildTransaction({ id: 'tx-1', refAmount: '1.234' })],
      applyRefunds: false,
      decimals: 3,
    });

    expect(base.map((leg) => leg.minor)).toEqual([1234]);
  });

  it('rounds the same amount to cents at 2 decimals', async () => {
    const { base } = await computeCategoryAllocations({
      transactions: [buildTransaction({ id: 'tx-1', refAmount: '1.234' })],
      applyRefunds: false,
      decimals: 2,
    });

    expect(base.map((leg) => leg.minor)).toEqual([123]);
  });

  it('keeps whole units at 0 decimals', async () => {
    const { base } = await computeCategoryAllocations({
      transactions: [buildTransaction({ id: 'tx-1', refAmount: '1500' })],
      applyRefunds: false,
      decimals: 0,
    });

    expect(base.map((leg) => leg.minor)).toEqual([1500]);
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
    refundsFindAll.mockResolvedValue([{ originalTxId: 'tx-1', refundTxId: 'tx-2', splitId: null, userId: 1 }]);

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
