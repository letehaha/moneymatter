import { TRANSACTION_TYPES, asDecimal } from '@bt/shared/types';
import { NONEXISTENT_ID, generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetTransactions from '@models/budget-transactions.model';
import * as helpers from '@tests/helpers';

const seedBudgetWithAttachedTransaction = async () => {
  const [transaction] = await helpers.createTransaction({ raw: true });

  const budget = await helpers.createCustomBudget({
    name: 'Budget For Removal Test',
    startDate: '2025-03-01T00:00:00Z',
    endDate: '2025-03-04T23:59:59Z',
    autoInclude: true,
    limitAmount: 500,
    raw: true,
  });

  await helpers.addTransactionToCustomBudget({
    id: budget.id,
    payload: { transactionIds: [transaction.id] },
  });

  return { budget, transaction };
};

const seedBudgetWithPlannedTransaction = async () => {
  const account = await helpers.createAccount({ raw: true });

  const [realTx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      amount: 100,
      transactionType: TRANSACTION_TYPES.expense,
      time: '2025-03-02T10:00:00Z',
    }),
    raw: true,
  });

  const [plannedTx] = await helpers.createPlannedTransaction({
    payload: {
      accountId: account.id,
      amount: 250,
      transactionType: TRANSACTION_TYPES.expense,
      time: '2025-03-03T10:00:00Z',
    },
    raw: true,
  });

  const budget = await helpers.createCustomBudget({
    name: 'Planned Attach Budget',
    startDate: '2025-03-01T00:00:00Z',
    endDate: '2025-03-31T23:59:59Z',
    autoInclude: false,
    limitAmount: 500,
    raw: true,
  });

  return { account, realTx, plannedTx, budget };
};

describe('Budget Transactions', () => {
  describe('Attach', () => {
    it('fails when adding duplicate transaction to the same budget if unique constraint exists', async () => {
      const account = await helpers.createAccount({ raw: true });

      const [transaction] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-02T12:00:00Z',
          categoryId: global.DEFAULT_CATEGORY_ID,
        }),
        raw: true,
      });

      const budget = await helpers.createCustomBudget({
        name: 'Duplicate Test Budget',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        autoInclude: false,
        limitAmount: 1000,
        raw: true,
      });

      const data = {
        transactionIds: [transaction.id],
      };

      await helpers.addTransactionToCustomBudget({
        id: budget.id,
        payload: data,
        raw: true,
      });

      const response = await helpers.addTransactionToCustomBudget({
        id: budget.id,
        payload: data,
        raw: false,
      });

      expect(response.body?.status).toBe('error');
    });

    it('attaches a balance-adjustment row in the same batch as a normal transaction', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      const [normalTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-02T12:00:00Z',
        }),
        raw: true,
      });

      const adjustment = await helpers.balanceAdjustment({
        id: account.id,
        payload: { targetBalance: asDecimal(500) },
        raw: true,
      });
      const adjustmentTx = adjustment.transaction!;

      const budget = await helpers.createCustomBudget({
        name: 'Balance Adjustment Budget',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        autoInclude: false,
        limitAmount: 1000,
        raw: true,
      });

      const response = await helpers.addTransactionToCustomBudget({
        id: budget.id,
        payload: { transactionIds: [normalTx.id, adjustmentTx.id] },
        raw: false,
      });

      expect(response.statusCode).toEqual(200);

      const linked = await helpers.getTransactions({ budgetIds: [budget.id], limit: 30, raw: true });
      expect(linked.map((tx) => tx.id).toSorted()).toEqual([normalTx.id, adjustmentTx.id].toSorted());
    });

    describe('planned transactions', () => {
      it('attaches an owner-selected planned transaction alongside real ones', async () => {
        const { realTx, plannedTx, budget } = await seedBudgetWithPlannedTransaction();

        const response = await helpers.addTransactionToCustomBudget({
          id: budget.id,
          payload: { transactionIds: [realTx.id, plannedTx.id] },
          raw: false,
        });

        expect(response.statusCode).toEqual(200);

        const linked = await helpers.getTransactions({ budgetIds: [budget.id], limit: 30, raw: true });
        expect(linked.map((tx) => tx.id).toSorted()).toEqual([realTx.id, plannedTx.id].toSorted());

        const stats = (await helpers.getStats({ id: budget.id, raw: true }))!;
        expect(stats.summary.transactionsCount).toBe(2);
        expect(stats.summary.actualExpense).toBe(350);
      }, 60_000);

      it('still rejects a batch containing a foreign transaction id', async () => {
        const { realTx, budget } = await seedBudgetWithPlannedTransaction();

        const response = await helpers.addTransactionToCustomBudget({
          id: budget.id,
          payload: { transactionIds: [realTx.id, generateRandomRecordId()] },
          raw: false,
        });

        expect(response.statusCode).toEqual(ERROR_CODES.ValidationError);

        const linked = await helpers.getTransactions({ budgetIds: [budget.id], limit: 30, raw: true });
        expect(linked).toEqual([]);
      });
    });
  });

  describe('Detach', () => {
    it('successfully removes transactions from a budget', async () => {
      const { budget, transaction } = await seedBudgetWithAttachedTransaction();

      const beforeRemoval = await BudgetTransactions.findOne({
        where: {
          budgetId: budget.id,
          transactionId: transaction.id,
        },
      });
      expect(beforeRemoval).toBeTruthy();

      const response = await helpers.removeTransactionFromCustomBudget({
        id: budget.id,
        payload: { transactionIds: [transaction.id] },
      });

      expect(response.statusCode).toEqual(200);

      const afterRemoval = await BudgetTransactions.findOne({
        where: {
          budgetId: budget.id,
          transactionId: transaction.id,
        },
      });
      expect(afterRemoval).toBeNull();
    });

    it('fails when trying to remove transactions from a non-existent budget', async () => {
      const [transaction] = await helpers.createTransaction({ raw: true });

      const response = await helpers.removeTransactionFromCustomBudget({
        id: NONEXISTENT_ID,
        payload: { transactionIds: [transaction.id] },
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('fails when trying to use invalid transaction id param type', async () => {
      const { budget } = await seedBudgetWithAttachedTransaction();

      expect(
        (
          await helpers.removeTransactionFromCustomBudget({
            id: budget.id,
            payload: { transactionIds: ['random-id' as unknown as string] },
          })
        ).statusCode,
      ).toBe(ERROR_CODES.ValidationError);

      expect(
        (
          await helpers.removeTransactionFromCustomBudget({
            id: budget.id,
            payload: { transactionIds: 122 as unknown as string[] },
          })
        ).statusCode,
      ).toBe(ERROR_CODES.ValidationError);
    });

    it('does not error when removing a transaction that is not in the budget', async () => {
      const [transaction] = await helpers.createTransaction({ raw: true });

      const budget = await helpers.createCustomBudget({
        name: 'Budget For Non-Existent Transaction Test',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-04T23:59:59Z',
        autoInclude: false,
        limitAmount: 500,
        raw: true,
      });

      const response = await helpers.removeTransactionFromCustomBudget({
        id: budget.id,
        payload: { transactionIds: [transaction.id] },
      });

      expect(response.statusCode).toEqual(200);
    });
  });
});
