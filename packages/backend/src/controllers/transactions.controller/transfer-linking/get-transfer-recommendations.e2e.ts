import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { addDays, startOfDay } from 'date-fns';

describe('getTransferRecommendations', () => {
  describe('success cases', () => {
    it('returns opposite-type recommendations for transactionId and form data queries', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      const [expenseTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const [incomeTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      const fromExpense = await helpers.getTransferRecommendations({
        transactionId: expenseTx.id,
        raw: true,
      });

      expect(fromExpense.length).toBeGreaterThanOrEqual(1);
      expect(fromExpense.some((tx) => tx.id === incomeTx.id)).toBe(true);
      expect(fromExpense.every((tx) => tx.transactionType === TRANSACTION_TYPES.income)).toBe(true);

      const fromIncome = await helpers.getTransferRecommendations({
        transactionId: incomeTx.id,
        raw: true,
      });

      expect(fromIncome.length).toBeGreaterThanOrEqual(1);
      expect(fromIncome.some((tx) => tx.id === expenseTx.id)).toBe(true);
      expect(fromIncome.every((tx) => tx.transactionType === TRANSACTION_TYPES.expense)).toBe(true);

      const fromFormData = await helpers.getTransferRecommendations({
        transactionType: TRANSACTION_TYPES.expense,
        originAmount: 100,
        accountId: account1.id,
        raw: true,
      });

      expect(fromFormData.length).toBeGreaterThanOrEqual(1);
      expect(fromFormData.some((tx) => tx.id === incomeTx.id)).toBe(true);
      expect(fromFormData.every((tx) => tx.transactionType === TRANSACTION_TYPES.income)).toBe(true);
    });

    it('excludes out-of-range, same-account, transfer-linked, refund-linked and split candidates', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });
      const account3 = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();
      const category1 = categories[0]!;
      const category2 = categories[1]!;

      // Source of 100.00 gives a ±10% window of 90.00 to 110.00
      const [expenseTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const [incomeInRange] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 105,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      const [incomeOutOfRange] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 150,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      const [incomeSameAccount] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      const [transferIncome] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: account3.id,
          destinationAmount: 100,
        }),
        raw: true,
      });

      const [originalExpense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const [refundIncome] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      await helpers.createSingleRefund(
        {
          originalTxId: originalExpense.id,
          refundTxId: refundIncome.id,
        },
        true,
      );

      const [incomeWithSplits] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: category1.id,
          splits: [{ categoryId: category2.id, amount: 50 }],
        }),
        raw: true,
      });

      const response = await helpers.getTransferRecommendations({
        transactionId: expenseTx.id,
        raw: true,
      });

      expect(response).toHaveLength(1);
      expect(response.some((tx) => tx.id === incomeInRange.id)).toBe(true);
      expect(response.some((tx) => tx.id === incomeOutOfRange.id)).toBe(false);
      expect(response.some((tx) => tx.id === incomeSameAccount.id)).toBe(false);
      expect(response.some((tx) => tx.id === transferIncome.id)).toBe(false);
      expect(response.some((tx) => tx.id === refundIncome.id)).toBe(false);
      expect(response.some((tx) => tx.id === incomeWithSplits.id)).toBe(false);
    }, 20000);

    describe('date filtering (±14 days symmetric window)', () => {
      it('applies the ±14 day window symmetrically in both directions', async () => {
        const account1 = await helpers.createAccount({ raw: true });
        const account2 = await helpers.createAccount({ raw: true });

        const baseDate = startOfDay(new Date());

        const createIncomeOnDay = async (offsetDays: number) => {
          const [tx] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account2.id,
              amount: 100,
              transactionType: TRANSACTION_TYPES.income,
              time: addDays(baseDate, offsetDays).toISOString(),
            }),
            raw: true,
          });
          return tx;
        };

        const [sourceExpense] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
            time: baseDate.toISOString(),
          }),
          raw: true,
        });

        const [sourceIncome] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.income,
            time: baseDate.toISOString(),
          }),
          raw: true,
        });

        const [expenseBefore5] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account2.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
            time: addDays(baseDate, -5).toISOString(),
          }),
          raw: true,
        });

        const incomeBefore20 = await createIncomeOnDay(-20);
        const incomeBefore5 = await createIncomeOnDay(-5);
        const incomeAfter5 = await createIncomeOnDay(5);
        const incomeAtBoundary14 = await createIncomeOnDay(14);
        const incomeAtBoundary15 = await createIncomeOnDay(15);
        const incomeAfter20 = await createIncomeOnDay(20);

        const fromExpense = await helpers.getTransferRecommendations({
          transactionId: sourceExpense.id,
          raw: true,
        });

        expect(fromExpense.some((tx) => tx.id === incomeBefore5.id)).toBe(true);
        expect(fromExpense.some((tx) => tx.id === incomeAfter5.id)).toBe(true);
        expect(fromExpense.some((tx) => tx.id === incomeAtBoundary14.id)).toBe(true);
        expect(fromExpense.some((tx) => tx.id === incomeBefore20.id)).toBe(false);
        expect(fromExpense.some((tx) => tx.id === incomeAtBoundary15.id)).toBe(false);
        expect(fromExpense.some((tx) => tx.id === incomeAfter20.id)).toBe(false);

        const fromIncome = await helpers.getTransferRecommendations({
          transactionId: sourceIncome.id,
          raw: true,
        });

        expect(fromIncome.some((tx) => tx.id === expenseBefore5.id)).toBe(true);
      });

      it('includes same-day transactions regardless of time-of-day differences', async () => {
        const account1 = await helpers.createAccount({ raw: true });
        const account2 = await helpers.createAccount({ raw: true });

        const baseDate = startOfDay(new Date());
        const expenseTime = new Date(baseDate);
        expenseTime.setHours(14, 0, 0, 0);
        const incomeTime = new Date(baseDate);
        incomeTime.setHours(8, 0, 0, 0);

        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
            time: expenseTime.toISOString(),
          }),
          raw: true,
        });

        const [incomeTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account2.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.income,
            time: incomeTime.toISOString(),
          }),
          raw: true,
        });

        const responseFromExpense = await helpers.getTransferRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });
        expect(responseFromExpense.some((tx) => tx.id === incomeTx.id)).toBe(true);

        const responseFromIncome = await helpers.getTransferRecommendations({
          transactionId: incomeTx.id,
          raw: true,
        });
        expect(responseFromIncome.some((tx) => tx.id === expenseTx.id)).toBe(true);
      });
    });

    describe('result limiting', () => {
      it('returns maximum 7 recommendations', async () => {
        const account1 = await helpers.createAccount({ raw: true });
        const account2 = await helpers.createAccount({ raw: true });

        // Create expense
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Create more than 7 income transactions
        for (let i = 0; i < 10; i++) {
          await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account2.id,
              amount: 100,
              transactionType: TRANSACTION_TYPES.income,
            }),
            raw: true,
          });
        }

        const response = await helpers.getTransferRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });

        expect(response.length).toBeLessThanOrEqual(7);
      });
    });

    describe('sorting', () => {
      it('prioritizes same currency matches', async () => {
        const account1 = await helpers.createAccount({ raw: true }); // Base currency
        const { account: account2 } = await helpers.createAccountWithNewCurrency({ currency: 'EUR' });
        const account3 = await helpers.createAccount({ raw: true }); // Base currency

        // Create expense in base currency
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Create income in different currency (EUR)
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account2.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // Create income in same currency (base)
        const [incomeSameCurrency] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account3.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const response = await helpers.getTransferRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });

        // Same currency should be prioritized (first in results)
        expect(response.length).toBeGreaterThanOrEqual(1);
        expect(response[0]?.id).toBe(incomeSameCurrency.id);
      });

      it('sorts by amount proximity (closer amounts first)', async () => {
        const account1 = await helpers.createAccount({ raw: true });
        const account2 = await helpers.createAccount({ raw: true });

        // Create expense: 100
        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        // Create income further from target: 108 (8% diff)
        const [incomeFarther] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account2.id,
            amount: 108,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        // Create income closer to target: 102 (2% diff)
        const [incomeCloser] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account2.id,
            amount: 102,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: true,
        });

        const response = await helpers.getTransferRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });

        expect(response.length).toBeGreaterThanOrEqual(2);
        const closerIndex = response.findIndex((tx) => tx.id === incomeCloser.id);
        const fartherIndex = response.findIndex((tx) => tx.id === incomeFarther.id);
        expect(closerIndex).toBeLessThan(fartherIndex);
      });
    });

    describe('empty results', () => {
      it('returns empty array for no matches, unknown transactionId and unknown accountId', async () => {
        const account = await helpers.createAccount({ raw: true });

        const [expenseTx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const noMatches = await helpers.getTransferRecommendations({
          transactionId: expenseTx.id,
          raw: true,
        });
        expect(noMatches).toEqual([]);

        const unknownTransaction = await helpers.getTransferRecommendations({
          transactionId: generateRandomRecordId(),
          raw: true,
        });
        expect(unknownTransaction).toEqual([]);

        const unknownAccount = await helpers.getTransferRecommendations({
          transactionType: TRANSACTION_TYPES.expense,
          originAmount: 100,
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
                amount: 100,
                transactionType: TRANSACTION_TYPES.expense,
              }),
              raw: true,
            });
            return { accountId: account.id, transactionId: expense.id };
          },
        });

        expect(await helpers.getTransferRecommendations({ transactionId: foreign.transactionId, raw: true })).toEqual(
          [],
        );
        expect(
          await helpers.getTransferRecommendations({
            transactionType: TRANSACTION_TYPES.expense,
            originAmount: 100,
            accountId: foreign.accountId,
            raw: true,
          }),
        ).toEqual([]);
      });
    });
  });

  describe('failure cases', () => {
    it('fails validation for incomplete or malformed parameters', async () => {
      const account = await helpers.createAccount({ raw: true });

      const cases = [
        { name: 'no parameters', params: {} },
        { name: 'only transactionType', params: { transactionType: TRANSACTION_TYPES.expense } },
        { name: 'only originAmount', params: { originAmount: 100 } },
        { name: 'only accountId', params: { accountId: account.id } },
        {
          name: 'transactionType and originAmount without accountId',
          params: { transactionType: TRANSACTION_TYPES.expense, originAmount: 100 },
        },
        {
          name: 'invalid transactionType',
          params: { transactionType: 'invalid' as TRANSACTION_TYPES, originAmount: 100, accountId: account.id },
        },
        {
          name: 'negative originAmount',
          params: { transactionType: TRANSACTION_TYPES.expense, originAmount: -100, accountId: account.id },
        },
        { name: 'invalid transactionId', params: { transactionId: 'not-a-uuid' } },
        {
          name: 'invalid accountId',
          params: { transactionType: TRANSACTION_TYPES.expense, originAmount: 100, accountId: 'not-a-uuid' },
        },
      ];

      const results: { name: string; statusCode: number }[] = [];

      for (const testCase of cases) {
        const response = await helpers.getTransferRecommendations(testCase.params);
        results.push({ name: testCase.name, statusCode: response.statusCode });
      }

      expect(results).toEqual(cases.map(({ name }) => ({ name, statusCode: ERROR_CODES.ValidationError })));
    });
  });
});
