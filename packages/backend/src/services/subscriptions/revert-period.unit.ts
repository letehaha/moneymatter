import { SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError } from '@js/errors';

// ── Mocks (hoisted before importing the module under test) ──────────────────

// The service reads the period through the model and decides about the payment
// transaction from its row and its account. Stubbing keeps this unit run free of the
// DB and queue connections the real import graph opens.
jest.mock('@models/subscription-periods.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('@models/transactions.model', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('@models/accounts.model', () => ({
  __esModule: true,
  isBankLinkedAccount: jest.fn(),
}));
jest.mock('@services/transactions/delete-transaction', () => ({
  __esModule: true,
  deleteTransaction: jest.fn(),
}));
jest.mock('./helpers', () => ({
  __esModule: true,
  findSubscriptionOrThrow: jest.fn(),
}));
// The unit test has no database transaction to open: the wrapper runs the function as is.
jest.mock('@services/common/with-transaction', () => ({
  __esModule: true,
  withTransaction: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

import { isBankLinkedAccount } from '@models/accounts.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Transactions from '@models/transactions.model';
import { deleteTransaction } from '@services/transactions/delete-transaction';

import { findSubscriptionOrThrow } from './helpers';
import { revertPeriod } from './revert-period';

const USER_ID = 42;
const SUBSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_ID = '22222222-2222-4222-8222-222222222222';
const TX_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';

const findPeriod = jest.mocked(SubscriptionPeriods.findOne);
const findTx = jest.mocked(Transactions.findByPk);
const bankLinked = jest.mocked(isBankLinkedAccount);
const removeTransaction = jest.mocked(deleteTransaction);
const findSubscription = jest.mocked(findSubscriptionOrThrow);

const makePeriod = ({ transactionAutoCreated = true, transactionId = TX_ID as string | null } = {}) => {
  const period = {
    id: PERIOD_ID,
    dueDate: '2026-09-01',
    status: SUBSCRIPTION_PERIOD_STATUSES.paid,
    transactionId,
    transactionAutoCreated,
    update: jest.fn(async () => period),
    reload: jest.fn(async () => period),
  };
  return period;
};

/** The first `findOne` is the locked read of the period; the two after it look for sibling periods. */
const givenPeriod = ({ period }: { period: ReturnType<typeof makePeriod> }) => {
  findPeriod.mockResolvedValueOnce(period as never);
  findPeriod.mockResolvedValue(null as never);
};

beforeEach(() => {
  jest.resetAllMocks();
  findSubscription.mockResolvedValue({ completedAt: null, update: jest.fn() } as never);
  bankLinked.mockResolvedValue(false);
  removeTransaction.mockResolvedValue(undefined as never);
  findTx.mockResolvedValue({ accountId: ACCOUNT_ID, isPlanned: false } as never);
});

describe('revertPeriod', () => {
  it('reads the period under a row lock', async () => {
    givenPeriod({ period: makePeriod({ transactionAutoCreated: false }) });

    await revertPeriod({ userId: USER_ID, subscriptionId: SUBSCRIPTION_ID, periodId: PERIOD_ID });

    expect(findPeriod.mock.calls[0]![0]).toMatchObject({
      where: { id: PERIOD_ID, subscriptionId: SUBSCRIPTION_ID },
      lock: true,
    });
  });

  describe('assertCanDeleteTransaction', () => {
    it('is asked once, before the transaction is deleted, when the revert deletes it', async () => {
      const order: string[] = [];
      const assertCanDeleteTransaction = jest.fn(() => {
        order.push('assert');
      });
      removeTransaction.mockImplementation((async () => {
        order.push('delete');
      }) as never);
      givenPeriod({ period: makePeriod() });

      await revertPeriod({
        userId: USER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        periodId: PERIOD_ID,
        assertCanDeleteTransaction,
      });

      expect(assertCanDeleteTransaction).toHaveBeenCalledTimes(1);
      expect(removeTransaction).toHaveBeenCalledWith({ id: TX_ID, userId: USER_ID });
      expect(order).toEqual(['assert', 'delete']);
    });

    it('is asked for a planned payment on a bank-linked account, which the revert still deletes', async () => {
      bankLinked.mockResolvedValue(true);
      findTx.mockResolvedValue({ accountId: ACCOUNT_ID, isPlanned: true } as never);
      const assertCanDeleteTransaction = jest.fn();
      givenPeriod({ period: makePeriod() });

      await revertPeriod({
        userId: USER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        periodId: PERIOD_ID,
        assertCanDeleteTransaction,
      });

      expect(assertCanDeleteTransaction).toHaveBeenCalledTimes(1);
      expect(removeTransaction).toHaveBeenCalledTimes(1);
    });

    it('stops the revert when it throws: nothing is deleted and the period is not updated', async () => {
      const period = makePeriod();
      givenPeriod({ period });

      await expect(
        revertPeriod({
          userId: USER_ID,
          subscriptionId: SUBSCRIPTION_ID,
          periodId: PERIOD_ID,
          assertCanDeleteTransaction: () => {
            throw new Error('Missing required scope: finance:delete.');
          },
        }),
      ).rejects.toThrow(/finance:delete/);

      expect(removeTransaction).not.toHaveBeenCalled();
      expect(period.update).not.toHaveBeenCalled();
    });

    it('is not asked when the payment transaction is the user’s own (linked, not created by the app)', async () => {
      const assertCanDeleteTransaction = jest.fn();
      const period = makePeriod({ transactionAutoCreated: false });
      givenPeriod({ period });

      await revertPeriod({
        userId: USER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        periodId: PERIOD_ID,
        assertCanDeleteTransaction,
      });

      expect(assertCanDeleteTransaction).not.toHaveBeenCalled();
      expect(removeTransaction).not.toHaveBeenCalled();
      expect(period.update).toHaveBeenCalledWith(expect.objectContaining({ transactionId: null }));
    });

    it('is not asked when the period has no transaction', async () => {
      const assertCanDeleteTransaction = jest.fn();
      givenPeriod({ period: makePeriod({ transactionId: null }) });

      await revertPeriod({
        userId: USER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        periodId: PERIOD_ID,
        assertCanDeleteTransaction,
      });

      expect(assertCanDeleteTransaction).not.toHaveBeenCalled();
      expect(findTx).not.toHaveBeenCalled();
    });

    it('is not asked when the transaction is already gone', async () => {
      findTx.mockResolvedValue(null as never);
      const assertCanDeleteTransaction = jest.fn();
      givenPeriod({ period: makePeriod() });

      await revertPeriod({
        userId: USER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        periodId: PERIOD_ID,
        assertCanDeleteTransaction,
      });

      expect(assertCanDeleteTransaction).not.toHaveBeenCalled();
      expect(removeTransaction).not.toHaveBeenCalled();
    });

    it('is not asked when a booked payment sits on a bank-linked account, which the revert keeps', async () => {
      bankLinked.mockResolvedValue(true);
      const assertCanDeleteTransaction = jest.fn();
      const period = makePeriod();
      givenPeriod({ period });

      await revertPeriod({
        userId: USER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        periodId: PERIOD_ID,
        assertCanDeleteTransaction,
      });

      expect(assertCanDeleteTransaction).not.toHaveBeenCalled();
      expect(removeTransaction).not.toHaveBeenCalled();
      expect(period.update).toHaveBeenCalledWith(expect.objectContaining({ transactionId: null }));
    });

    it('is optional: without it the revert deletes the created transaction, as REST does', async () => {
      const period = makePeriod();
      givenPeriod({ period });

      await revertPeriod({ userId: USER_ID, subscriptionId: SUBSCRIPTION_ID, periodId: PERIOD_ID });

      expect(removeTransaction).toHaveBeenCalledWith({ id: TX_ID, userId: USER_ID });
      expect(period.update).toHaveBeenCalledWith(expect.objectContaining({ transactionId: null }));
    });

    it('still lets the revert finish when the transaction vanishes between the check and the delete', async () => {
      removeTransaction.mockRejectedValue(new NotFoundError({ message: 'gone' }));
      const period = makePeriod();
      givenPeriod({ period });

      await revertPeriod({
        userId: USER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        periodId: PERIOD_ID,
        assertCanDeleteTransaction: jest.fn(),
      });

      expect(period.update).toHaveBeenCalled();
    });
  });
});
