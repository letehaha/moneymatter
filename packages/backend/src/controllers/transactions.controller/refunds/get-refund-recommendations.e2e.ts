import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { subMonths } from 'date-fns';

describe('getRefundRecommendations', () => {
  describe('success cases', () => {
    describe('recommendation direction', () => {
      it('recommends the opposite type for both transactionId and form-data lookups', async () => {
        const account = await helpers.createAccount({ raw: true });

        // 50.00 decimal = 5000 cents, so both sit inside each other's ±5000-cent window.
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });
        const [incomeTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const fromExpense = await helpers.getRefundRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });

        expect(fromExpense.some((tx) => tx.id === incomeTx.id)).toBe(true);
        expect(fromExpense.every((tx) => tx.transactionType === TRANSACTION_TYPES.income)).toBe(true);

        const fromIncome = await helpers.getRefundRecommendations({
          transactionId: incomeTx.id,
          raw: true,
        });

        expect(fromIncome.some((tx) => tx.id === expenseTx.id)).toBe(true);
        expect(fromIncome.every((tx) => tx.transactionType === TRANSACTION_TYPES.expense)).toBe(true);

        const formExpense = await helpers.getRefundRecommendations({
          transactionType: TRANSACTION_TYPES.expense,
          originAmount: 50,
          accountId: account.id,
          raw: true,
        });

        expect(formExpense.some((tx) => tx.id === incomeTx.id)).toBe(true);
        expect(formExpense.every((tx) => tx.transactionType === TRANSACTION_TYPES.income)).toBe(true);

        const formIncome = await helpers.getRefundRecommendations({
          transactionType: TRANSACTION_TYPES.income,
          originAmount: 50,
          accountId: account.id,
          raw: true,
        });

        expect(formIncome.some((tx) => tx.id === expenseTx.id)).toBe(true);
        expect(formIncome.every((tx) => tx.transactionType === TRANSACTION_TYPES.expense)).toBe(true);
      });
    });

    describe('amount filtering', () => {
      it('filters candidates to the refAmount range (±5000 cents = ±50 decimal)', async () => {
        const account = await helpers.createAccount({ raw: true });

        // Create an expense transaction with 100.00 decimal (= 10000 cents)
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100, // 100.00 decimal = 10000 cents
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Create income within range: 120.00 decimal = 12000 cents
        // Range for 10000 cents ± 5000 = [5000, 15000] cents = [50, 150] decimal
        const [incomeInRange] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 120, // 120.00 decimal = 12000 cents, within [5000, 15000]
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // Create income outside range: 200.00 decimal = 20000 cents (outside [5000, 15000])
        const [incomeOutOfRange] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 200, // 200.00 decimal = 20000 cents, outside range
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const response = await helpers.getRefundRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });

        expect(response.some((tx) => tx.id === incomeInRange.id)).toBe(true);
        expect(response.some((tx) => tx.id === incomeOutOfRange.id)).toBe(false);
      });
    });

    describe('date window', () => {
      it('only recommends candidates from the last 6 months', async () => {
        const account = await helpers.createAccount({ raw: true });

        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });
        const [recentIncome] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.income,
            time: subMonths(new Date(), 3).toISOString(),
          }),
          raw: true,
        });
        const [staleIncome] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.income,
            time: subMonths(new Date(), 8).toISOString(),
          }),
          raw: true,
        });

        const response = await helpers.getRefundRecommendations({ transactionId: expenseTx.id, raw: true });

        expect(response.some((tx) => tx.id === recentIncome.id)).toBe(true);
        expect(response.some((tx) => tx.id === staleIncome.id)).toBe(false);
      });
    });

    describe('exclusion filters', () => {
      it('excludes transfer and planned transactions from recommendations', async () => {
        const account1 = await helpers.createAccount({ raw: true });
        const account2 = await helpers.createAccount({ raw: true });

        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Income that is one leg of a transfer
        const [transferIncome] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.income,
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationAccountId: account2.id,
            destinationAmount: 5000,
          }),
          raw: true,
        });

        const [plannedIncome] = await helpers.createPlannedTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // Positive control, so the absence assertions cannot pass on an empty response
        const [plainIncome] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const response = await helpers.getRefundRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });

        const ids = response.map((tx) => tx.id);
        expect(ids).toContain(plainIncome.id);
        expect(ids).not.toContain(transferIncome.id);
        expect(ids).not.toContain(plannedIncome.id);
      });
    });

    describe('refund transactions filtering', () => {
      it('does not recommend transactions that are already refunds of another transaction', async () => {
        const account = await helpers.createAccount({ raw: true });

        const [refundedExpense] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });
        // Income that IS the refund of that expense — cannot be linked again
        const [refundIncome] = await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 50,
              transactionType: TRANSACTION_TYPES.income,
            }),
            refundForTxId: refundedExpense.id,
          },
          raw: true,
        });
        const [plainIncome] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });
        const [currentExpense] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const response = await helpers.getRefundRecommendations({
          transactionId: currentExpense.id,
          raw: true,
        });

        const ids = response.map((tx) => tx.id);
        expect(ids).toContain(plainIncome.id);
        expect(ids).not.toContain(refundIncome.id);
      });

      it('still recommends originals that already carry refunds (partial refunds)', async () => {
        const account = await helpers.createAccount({ raw: true });

        const [refundedIncome] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });
        await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 20,
              transactionType: TRANSACTION_TYPES.expense,
            }),
            refundForTxId: refundedIncome.id,
          },
          raw: true,
        });
        const [currentExpense] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const response = await helpers.getRefundRecommendations({
          transactionId: currentExpense.id,
          raw: true,
        });

        expect(response.map((tx) => tx.id)).toContain(refundedIncome.id);
      });

      it('keeps recommending refunds already linked to the requested transaction', async () => {
        const account = await helpers.createAccount({ raw: true });

        const [currentExpense] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });
        // Income already refunding the requested transaction — must stay visible so the
        // edit dialog can list/deselect the existing link
        const [ownRefundIncome] = await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 50,
              transactionType: TRANSACTION_TYPES.income,
            }),
            refundForTxId: currentExpense.id,
          },
          raw: true,
        });

        const [otherExpense] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });
        const [otherRefundIncome] = await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 50,
              transactionType: TRANSACTION_TYPES.income,
            }),
            refundForTxId: otherExpense.id,
          },
          raw: true,
        });

        const response = await helpers.getRefundRecommendations({
          transactionId: currentExpense.id,
          raw: true,
        });

        const ids = response.map((tx) => tx.id);
        expect(ids).toContain(ownRefundIncome.id);
        expect(ids).not.toContain(otherRefundIncome.id);
      });
    });

    describe('result limiting', () => {
      it('returns maximum 5 recommendations', async () => {
        const account = await helpers.createAccount({ raw: true });

        // Create an expense transaction
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Create more than 5 income transactions
        for (let i = 0; i < 7; i++) {
          await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 5000,
              transactionType: TRANSACTION_TYPES.income,
            }),
            raw: true,
          });
        }

        const response = await helpers.getRefundRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });

        expect(response.length).toBeLessThanOrEqual(5);
      });
    });

    describe('empty results', () => {
      it('returns an empty array with no candidates, an unknown transactionId or an unknown accountId', async () => {
        const account = await helpers.createAccount({ raw: true });

        // Create only an expense transaction, no incomes
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const noCandidates = await helpers.getRefundRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });

        expect(noCandidates).toEqual([]);

        const unknownTransaction = await helpers.getRefundRecommendations({
          transactionId: generateRandomRecordId(),
          raw: true,
        });

        expect(unknownTransaction).toEqual([]);

        const unknownAccount = await helpers.getRefundRecommendations({
          transactionType: TRANSACTION_TYPES.expense,
          originAmount: 50,
          accountId: generateRandomRecordId(),
          raw: true,
        });

        expect(unknownAccount).toEqual([]);
      });

      it("returns an empty array for another user's transaction or account", async () => {
        const otherUser = await helpers.provisionSecondUserWithBaseCurrency();
        const foreign = await helpers.asUser({
          cookies: otherUser.cookies,
          fn: async () => {
            const account = await helpers.createAccount({ raw: true });
            const category = await helpers.addCustomCategory({ name: 'Other', color: '#0000FF', raw: true });
            const [expense] = await helpers.createTransaction({
              payload: helpers.buildTransactionPayload({
                accountId: account.id,
                categoryId: category.id,
                amount: 50,
                transactionType: TRANSACTION_TYPES.expense,
              }),
              raw: true,
            });
            return { accountId: account.id, transactionId: expense.id };
          },
        });

        expect(await helpers.getRefundRecommendations({ transactionId: foreign.transactionId, raw: true })).toEqual([]);
        expect(
          await helpers.getRefundRecommendations({
            transactionType: TRANSACTION_TYPES.expense,
            originAmount: 50,
            accountId: foreign.accountId,
            raw: true,
          }),
        ).toEqual([]);
      });
    });

    describe('splits inclusion', () => {
      it('includes transactions with splits in recommendations', async () => {
        const account = await helpers.createAccount({ raw: true });
        const categories = await helpers.getCategoriesList();
        const category1 = categories[0]!;
        const category2 = categories[1]!;

        // Create an expense transaction
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Create an income transaction with splits
        const [incomeWithSplits] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 5000,
            transactionType: TRANSACTION_TYPES.income,
            categoryId: category1.id,
            splits: [{ categoryId: category2.id, amount: 2000 }],
          }),
          raw: true,
        });

        const response = await helpers.getRefundRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });

        const foundTx = response.find((tx) => tx.id === incomeWithSplits.id);
        expect(foundTx).toBeDefined();
        expect(foundTx?.splits).toBeDefined();
        expect(foundTx?.splits?.length).toBeGreaterThan(0);
      });
    });
  });

  describe('failure cases', () => {
    it('fails validation for incomplete or malformed parameters', async () => {
      const account = await helpers.createAccount({ raw: true });

      const cases = [
        { name: 'no parameters', params: {} },
        { name: 'only transactionType', params: { transactionType: TRANSACTION_TYPES.expense } },
        { name: 'only originAmount', params: { originAmount: 50 } },
        { name: 'only accountId', params: { accountId: account.id } },
        {
          name: 'transactionType and originAmount without accountId',
          params: { transactionType: TRANSACTION_TYPES.expense, originAmount: 50 },
        },
        {
          name: 'invalid transactionType',
          params: { transactionType: 'invalid' as TRANSACTION_TYPES, originAmount: 50, accountId: account.id },
        },
        {
          name: 'negative originAmount',
          params: { transactionType: TRANSACTION_TYPES.expense, originAmount: -50, accountId: account.id },
        },
        { name: 'invalid transactionId', params: { transactionId: 'not-a-uuid' } },
        {
          name: 'invalid accountId',
          params: { transactionType: TRANSACTION_TYPES.expense, originAmount: 50, accountId: 'not-a-uuid' },
        },
      ];

      const results: { name: string; statusCode: number }[] = [];

      for (const testCase of cases) {
        const response = await helpers.getRefundRecommendations(testCase.params);
        results.push({ name: testCase.name, statusCode: response.statusCode });
      }

      expect(results).toEqual(cases.map(({ name }) => ({ name, statusCode: ERROR_CODES.ValidationError })));
    });
  });
});
