import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { startOfDay, subDays } from 'date-fns';

const today = startOfDay(new Date());
const todayISO = today.toISOString();
const thirtyDaysAgo = subDays(today, 30).toISOString();

describe('bulkScanTransferRecommendations', () => {
  describe('success cases', () => {
    it('returns matching expense-income pairs with confidence scores between 0 and 100', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      // Create an expense
      const [expense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      // Create a matching income on a different account
      const [income] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          time: todayISO,
        }),
        raw: true,
      });

      const response = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        raw: true,
      });

      expect(response.total).toBeGreaterThanOrEqual(1);
      const pair = response.items.find((item) => item.expense.id === expense.id);
      expect(pair).toBeDefined();
      expect(pair!.matches.length).toBeGreaterThanOrEqual(1);
      expect(pair!.matches.some((m) => m.transaction.id === income.id)).toBe(true);

      for (const item of response.items) {
        for (const match of item.matches) {
          expect(match.confidence).toBeGreaterThanOrEqual(0);
          expect(match.confidence).toBeLessThanOrEqual(100);
        }
      }
    });

    it('gives higher confidence to exact amount + same day + same currency', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      const [expense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      // Perfect match: same amount, same day
      const [perfectMatch] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          time: todayISO,
        }),
        raw: true,
      });

      // Weaker match: slightly different amount, 5 days apart
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 520,
          transactionType: TRANSACTION_TYPES.income,
          time: subDays(today, 5).toISOString(),
        }),
        raw: true,
      });

      const response = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        raw: true,
      });

      const pair = response.items.find((item) => item.expense.id === expense.id);
      expect(pair).toBeDefined();
      expect(pair!.matches.length).toBeGreaterThanOrEqual(2);

      // First match should be the perfect one (highest confidence)
      expect(pair!.matches[0]!.transaction.id).toBe(perfectMatch.id);
      expect(pair!.matches[0]!.confidence).toBeGreaterThan(pair!.matches[1]!.confidence);
    });

    it('excludes transactions already linked as transfers', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      // Create a transfer pair (already linked)
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: account2.id,
          destinationAmount: 500,
        }),
        raw: true,
      });

      const response = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        raw: true,
      });

      // The already-linked expense should not appear in results
      const linkedExpenses = response.items.filter(
        (item) => item.expense.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer,
      );
      expect(linkedExpenses.length).toBe(0);
    });

    it('respects amount (±10%) and date (±14 days) tolerances and excludes same-account matches', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      const [amountExpense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      const [amountWithinRange] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 109,
          transactionType: TRANSACTION_TYPES.income,
          time: todayISO,
        }),
        raw: true,
      });

      const [amountOutsideRange] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 112,
          transactionType: TRANSACTION_TYPES.income,
          time: todayISO,
        }),
        raw: true,
      });

      const [dateExpense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      const [dateWithinRange] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          time: subDays(today, 10).toISOString(),
        }),
        raw: true,
      });

      const [dateOutsideRange] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          time: subDays(today, 15).toISOString(),
        }),
        raw: true,
      });

      // Expense and income on the SAME account, with no counterpart elsewhere
      const [sameAccountExpense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 700,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 700,
          transactionType: TRANSACTION_TYPES.income,
          time: todayISO,
        }),
        raw: true,
      });

      const response = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        raw: true,
      });

      const amountPair = response.items.find((item) => item.expense.id === amountExpense.id);
      expect(amountPair).toBeDefined();
      expect(amountPair!.matches.some((m) => m.transaction.id === amountWithinRange.id)).toBe(true);
      expect(amountPair!.matches.some((m) => m.transaction.id === amountOutsideRange.id)).toBe(false);

      const datePair = response.items.find((item) => item.expense.id === dateExpense.id);
      expect(datePair).toBeDefined();
      expect(datePair!.matches.some((m) => m.transaction.id === dateWithinRange.id)).toBe(true);
      expect(datePair!.matches.some((m) => m.transaction.id === dateOutsideRange.id)).toBe(false);

      expect(response.items.find((item) => item.expense.id === sameAccountExpense.id)).toBeUndefined();
    });

    it('returns max 4 matches per expense', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      // Create 6 matching incomes
      for (let i = 0; i < 6; i++) {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account2.id,
            amount: 500 + i,
            transactionType: TRANSACTION_TYPES.income,
            time: subDays(today, i).toISOString(),
          }),
          raw: true,
        });
      }

      const response = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        raw: true,
      });

      for (const item of response.items) {
        expect(item.matches.length).toBeLessThanOrEqual(4);
      }
    });

    it('includes out-of-wallet transfers only when includeOutOfWallet is set', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      const [outOfWalletExpense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 640,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
        }),
        raw: true,
      });
      const [regularIncome] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 640,
          transactionType: TRANSACTION_TYPES.income,
          time: todayISO,
        }),
        raw: true,
      });

      const withoutFlag = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        raw: true,
      });
      expect(withoutFlag.items.some((item) => item.expense.id === outOfWalletExpense.id)).toBe(false);

      const withFlag = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        includeOutOfWallet: true,
        raw: true,
      });
      const item = withFlag.items.find((entry) => entry.expense.id === outOfWalletExpense.id);
      expect(item).toBeDefined();
      expect(item!.matches.some((match) => match.transaction.id === regularIncome.id)).toBe(true);
    });

    it('returns empty results for date range with no expenses', async () => {
      const response = await helpers.bulkScanTransferRecommendations({
        from: subDays(today, 365).toISOString(),
        to: subDays(today, 300).toISOString(),
        raw: true,
      });

      expect(response.total).toBe(0);
      expect(response.items).toEqual([]);
    });

    it('supports pagination with limit and offset', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      // Create 3 expenses with matches
      for (let i = 0; i < 3; i++) {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 100 * (i + 1),
            transactionType: TRANSACTION_TYPES.expense,
            time: subDays(today, i).toISOString(),
          }),
          raw: true,
        });

        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account2.id,
            amount: 100 * (i + 1),
            transactionType: TRANSACTION_TYPES.income,
            time: subDays(today, i).toISOString(),
          }),
          raw: true,
        });
      }

      // Get first page (limit 2)
      const page1 = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        limit: 2,
        offset: 0,
        raw: true,
      });

      expect(page1.total).toBeGreaterThanOrEqual(3);
      expect(page1.items.length).toBe(2);

      // Get second page
      const page2 = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        limit: 2,
        offset: 2,
        raw: true,
      });

      expect(page2.total).toBeGreaterThanOrEqual(3);
      expect(page2.items.length).toBeGreaterThanOrEqual(1);

      // No overlap between pages
      const page1Ids = page1.items.map((item) => item.expense.id);
      const page2Ids = page2.items.map((item) => item.expense.id);
      expect(page1Ids.filter((id) => page2Ids.includes(id))).toEqual([]);
    });

    it('finds incomes outside the date range that are within ±14 days of boundary expenses', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      // Expense at the start of the date range
      const rangeStart = subDays(today, 20);
      const [expense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          time: rangeStart.toISOString(),
        }),
        raw: true,
      });

      // Income 10 days before the range start (outside date range but within ±14 days of the expense)
      const [incomeOutsideRange] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          time: subDays(rangeStart, 10).toISOString(),
        }),
        raw: true,
      });

      const response = await helpers.bulkScanTransferRecommendations({
        from: rangeStart.toISOString(),
        to: todayISO,
        raw: true,
      });

      const pair = response.items.find((item) => item.expense.id === expense.id);
      expect(pair).toBeDefined();
      expect(pair!.matches.some((m) => m.transaction.id === incomeOutsideRange.id)).toBe(true);
    });

    it('sorts results by expense date descending', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      const dates = [subDays(today, 10), subDays(today, 5), today];

      for (const date of dates) {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account1.id,
            amount: 500,
            transactionType: TRANSACTION_TYPES.expense,
            time: date.toISOString(),
          }),
          raw: true,
        });

        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account2.id,
            amount: 500,
            transactionType: TRANSACTION_TYPES.income,
            time: date.toISOString(),
          }),
          raw: true,
        });
      }

      const response = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        raw: true,
      });

      // Check that expenses are sorted newest first
      for (let i = 1; i < response.items.length; i++) {
        const prevTime = new Date(response.items[i - 1]!.expense.time).getTime();
        const currTime = new Date(response.items[i]!.expense.time).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }
    });
  });

  describe('error cases', () => {
    it('returns validation error for malformed date range and limit', async () => {
      const fromAfterTo = await helpers.bulkScanTransferRecommendations({
        from: todayISO,
        to: thirtyDaysAgo,
      });
      expect(fromAfterTo.statusCode).toBe(ERROR_CODES.ValidationError);

      const missingDates = await helpers.bulkScanTransferRecommendations({
        from: '',
        to: '',
      });
      expect(missingDates.statusCode).toBe(ERROR_CODES.ValidationError);

      const limitTooBig = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        limit: 100,
      });
      expect(limitTooBig.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});

describe('dismissTransferSuggestion', () => {
  describe('success cases', () => {
    it('dismisses a suggestion pair and returns 204', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      const [expense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      const [income] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.income,
          time: todayISO,
        }),
        raw: true,
      });

      const response = await helpers.dismissTransferSuggestion({
        expenseTransactionId: expense.id,
        incomeTransactionId: income.id,
      });

      expect(response.statusCode).toBe(204);
    });

    it('is idempotent — dismissing the same pair twice succeeds', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      const [expense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 300,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      const [income] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 300,
          transactionType: TRANSACTION_TYPES.income,
          time: todayISO,
        }),
        raw: true,
      });

      const first = await helpers.dismissTransferSuggestion({
        expenseTransactionId: expense.id,
        incomeTransactionId: income.id,
      });
      expect(first.statusCode).toBe(204);

      const second = await helpers.dismissTransferSuggestion({
        expenseTransactionId: expense.id,
        incomeTransactionId: income.id,
      });
      expect(second.statusCode).toBe(204);
    });

    it('dismissed pairs are excluded from bulk-scan results', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      const [expense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 700,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      const [income] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account2.id,
          amount: 700,
          transactionType: TRANSACTION_TYPES.income,
          time: todayISO,
        }),
        raw: true,
      });

      // Verify the pair appears before dismissing
      const beforeDismiss = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        raw: true,
      });

      const pairBefore = beforeDismiss.items.find((item) => item.expense.id === expense.id);
      expect(pairBefore).toBeDefined();
      expect(pairBefore!.matches.some((m) => m.transaction.id === income.id)).toBe(true);

      // Dismiss the pair
      await helpers.dismissTransferSuggestion({
        expenseTransactionId: expense.id,
        incomeTransactionId: income.id,
      });

      // Verify the dismissed pair no longer appears
      const afterDismiss = await helpers.bulkScanTransferRecommendations({
        from: thirtyDaysAgo,
        to: todayISO,
        raw: true,
      });

      expect(
        afterDismiss.items.some(
          (item) => item.expense.id === expense.id && item.matches.some((m) => m.transaction.id === income.id),
        ),
      ).toBe(false);
    });
  });

  describe('error cases', () => {
    it('returns validation error for missing and malformed transaction ids', async () => {
      const missingExpenseId = await helpers.dismissTransferSuggestion({
        expenseTransactionId: undefined as unknown as string,
        incomeTransactionId: generateRandomRecordId(),
      });
      expect(missingExpenseId.statusCode).toBe(ERROR_CODES.ValidationError);

      const missingIncomeId = await helpers.dismissTransferSuggestion({
        expenseTransactionId: generateRandomRecordId(),
        incomeTransactionId: undefined as unknown as string,
      });
      expect(missingIncomeId.statusCode).toBe(ERROR_CODES.ValidationError);

      const invalidIds = await helpers.dismissTransferSuggestion({
        expenseTransactionId: 'not-a-uuid' as string,
        incomeTransactionId: 'also-not-a-uuid' as string,
      });
      expect(invalidIds.statusCode).toBe(ERROR_CODES.ValidationError);

      const unknownIds = await helpers.dismissTransferSuggestion({
        expenseTransactionId: generateRandomRecordId(),
        incomeTransactionId: generateRandomRecordId(),
      });
      expect(unknownIds.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('refuses a pair when one transaction is unknown or belongs to another user', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const [expense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account1.id,
          amount: 450,
          transactionType: TRANSACTION_TYPES.expense,
          time: todayISO,
        }),
        raw: true,
      });

      const oneUnknown = await helpers.dismissTransferSuggestion({
        expenseTransactionId: expense.id,
        incomeTransactionId: generateRandomRecordId(),
      });
      expect(oneUnknown.statusCode).toBe(ERROR_CODES.ValidationError);

      const otherUser = await helpers.provisionSecondUserWithBaseCurrency();
      const foreignIncomeId = await helpers.asUser({
        cookies: otherUser.cookies,
        fn: async () => {
          const account = await helpers.createAccount({ raw: true });
          const category = await helpers.addCustomCategory({ name: 'Other', color: '#0000FF', raw: true });
          const [income] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              categoryId: category.id,
              amount: 450,
              transactionType: TRANSACTION_TYPES.income,
              time: todayISO,
            }),
            raw: true,
          });
          return income.id;
        },
      });

      const foreign = await helpers.dismissTransferSuggestion({
        expenseTransactionId: expense.id,
        incomeTransactionId: foreignIncomeId,
      });
      expect(foreign.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});
