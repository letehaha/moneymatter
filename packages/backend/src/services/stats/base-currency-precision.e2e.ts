import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, format, subDays } from 'date-fns';

/**
 * The stats reports compute in integer minor units at the base currency's decimals, so a
 * KWD-base user (3 decimals) gets the same exact amounts that are stored. The 2-decimal block
 * below runs the same flow for the primary user and keeps today's values.
 */

const NOW = new Date();
const TIME = NOW.toISOString();
const FROM = format(subDays(NOW, 2), 'yyyy-MM-dd');
const TO = format(addDays(NOW, 1), 'yyyy-MM-dd');
const TODAY = format(NOW, 'yyyy-MM-dd');
const WINDOW = { from: FROM, to: TO };

interface Book {
  /** Account in the base currency holding the expense. */
  baseAccountId: RecordId;
  /** Account in a second currency holding the converted income. */
  foreignAccountId: RecordId;
  categoryId: RecordId;
}

const createTransactionOn = ({
  accountId,
  categoryId,
  amount,
  transactionType,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  transactionType: TRANSACTION_TYPES;
}) =>
  helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, categoryId, amount, transactionType, time: TIME }),
    raw: true,
  });

/**
 * KWD-base book: a KWD expense of 1.234 and a JPY income of 1555 that converts to
 * 1555 * 0.0005 = 0.7775, which half-even rounds to 0.778 at 3 decimals.
 */
const seedKwdBook = async (): Promise<Book> => {
  await helpers.addUserCurrencies({ currencyCodes: ['KWD', 'JPY'], raw: true });
  const category = await helpers.addCustomCategory({ name: 'Precision', color: '#AABBCC', raw: true });
  const baseAccount = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'KWD' }),
    raw: true,
  });
  const foreignAccount = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'JPY' }),
    raw: true,
  });
  await helpers.updateUserCurrency({ currency: { currencyCode: 'JPY', liveRateUpdate: false }, raw: true });
  await helpers.editCurrencyExchangeRate({
    pairs: [
      { baseCode: 'JPY', quoteCode: 'KWD', rate: 0.0005 },
      { baseCode: 'KWD', quoteCode: 'JPY', rate: 2000 },
    ],
  });

  await createTransactionOn({
    accountId: baseAccount.id,
    categoryId: category.id,
    amount: 1.234,
    transactionType: TRANSACTION_TYPES.expense,
  });
  await createTransactionOn({
    accountId: foreignAccount.id,
    categoryId: category.id,
    amount: 1555,
    transactionType: TRANSACTION_TYPES.income,
  });

  return { baseAccountId: baseAccount.id, foreignAccountId: foreignAccount.id, categoryId: category.id };
};

const inKwdBook = async (fn: (book: Book) => Promise<void>) => {
  const kwdUser = await helpers.provisionSecondUserWithBaseCurrency({ currencyCode: 'KWD' });

  await helpers.asUser({
    cookies: kwdUser.cookies,
    fn: async () => fn(await seedKwdBook()),
  });
};

/** The last balance row an account carries in the window, as the chart reads it. */
const lastBalanceOf = ({ rows, accountId }: { rows: { accountId: string; amount: unknown }[]; accountId: RecordId }) =>
  Number(rows.filter((row) => row.accountId === accountId).at(-1)!.amount);

describe('Stats in the base currency decimals', () => {
  describe('KWD base currency (3 decimals)', () => {
    it('reports total-balance at 3 decimals', async () => {
      await inKwdBook(async () => {
        const total = await helpers.getTotalBalance({ date: TODAY, raw: true });

        expect(total).toBe(-0.456);
      });
    });

    it('reports balance-history rows at 3 decimals', async () => {
      await inKwdBook(async ({ baseAccountId, foreignAccountId }) => {
        const rows = await helpers.getBalanceHistory({ ...WINDOW, raw: true });

        expect(lastBalanceOf({ rows, accountId: baseAccountId })).toBe(-1.234);
        expect(lastBalanceOf({ rows, accountId: foreignAccountId })).toBe(0.778);
      });
    });

    it('reports spendings-by-categories and expenses-amount-for-period at 3 decimals', async () => {
      await inKwdBook(async ({ categoryId }) => {
        const spendings = await helpers.getSpendingsByCategories({ ...WINDOW, raw: true });
        const incomes = await helpers.getSpendingsByCategories({
          ...WINDOW,
          type: TRANSACTION_TYPES.income,
          raw: true,
        });
        const byType = await helpers.getSpendingsByCategories({ ...WINDOW, groupByType: true, raw: true });
        const expenses = await helpers.getExpensesAmountForPeriod({ ...WINDOW, raw: true });

        expect(spendings[categoryId].amount).toBe(1.234);
        expect(incomes[categoryId].amount).toBe(0.778);
        expect(byType[categoryId]).toMatchObject({ income: 0.778, expense: 1.234 });
        expect(expenses).toBe(1.234);
      });
    });

    it('reports cash-flow periods and totals at 3 decimals', async () => {
      await inKwdBook(async () => {
        const cashFlow = await helpers.getCashFlow({ ...WINDOW, granularity: 'monthly', raw: true });

        expect(cashFlow.totals).toMatchObject({ income: 0.778, expenses: 1.234, netFlow: -0.456 });
        const periodIncome = cashFlow.periods.reduce((sum, period) => sum + period.income, 0);
        expect(Number(periodIncome.toFixed(3))).toBe(0.778);
      });
    });

    it('reports the pivot grand total and cells at 3 decimals', async () => {
      await inKwdBook(async ({ categoryId }) => {
        const expense = await helpers.getPivotReport({
          ...WINDOW,
          granularity: 'monthly',
          rowDimension: 'category',
          measure: 'expense',
          raw: true,
        });
        const income = await helpers.getPivotReport({
          ...WINDOW,
          granularity: 'monthly',
          rowDimension: 'category',
          measure: 'income',
          raw: true,
        });
        const byPayee = await helpers.getPivotReport({
          ...WINDOW,
          granularity: 'monthly',
          rowDimension: 'payee',
          measure: 'income',
          raw: true,
        });

        expect(expense.grandTotal).toBe(1.234);
        expect(expense.rows.find((row) => row.id === categoryId)!.total).toBe(1.234);
        expect(income.grandTotal).toBe(0.778);
        expect(byPayee.grandTotal).toBe(0.778);
      });
    });

    it('reports cumulative totals at 3 decimals', async () => {
      await inKwdBook(async () => {
        const expenses = await helpers.getCumulativeData({ ...WINDOW, metric: 'expenses', raw: true });
        const savings = await helpers.getCumulativeData({ ...WINDOW, metric: 'savings', raw: true });

        expect(expenses.currentPeriod.total).toBe(1.234);
        expect(savings.currentPeriod.total).toBe(-0.456);
      });
    });

    it('sums the transactions summary at 3 decimals', async () => {
      await inKwdBook(async ({ baseAccountId, foreignAccountId }) => {
        const summary = await helpers.getTransactionsSummary({
          accountIds: [baseAccountId, foreignAccountId],
          raw: true,
        });

        expect(summary).toEqual({ count: 2, income: 0.778, expense: 1.234, net: -0.456, transfers: 0 });
      });
    });

    it('reports combined-balance-history at 3 decimals', async () => {
      await inKwdBook(async () => {
        const rows = await helpers.getCombinedBalanceHistory({ ...WINDOW, raw: true });
        const today = rows.find((row) => row.date === TODAY)!;

        expect(today.accountsBalance).toBe(-0.456);
        expect(today.totalBalance).toBe(-0.456);
      });
    });

    it('reports net-worth-history assets and net worth at 3 decimals', async () => {
      await inKwdBook(async () => {
        const { points } = await helpers.getNetWorthHistory({ ...WINDOW, granularity: 'weekly', raw: true });
        const last = points.at(-1)!;

        expect(last.assets.cash).toBe(0.778);
        expect(last.assetsTotal).toBe(0.778);
        expect(last.liabilitiesTotal).toBe(-1.234);
        expect(last.netWorth).toBe(-0.456);
      });
    });

    it('reports net-worth-drivers savings at 3 decimals', async () => {
      await inKwdBook(async () => {
        const { buckets } = await helpers.getNetWorthDrivers({ ...WINDOW, granularity: 'monthly', raw: true });
        const sum = (pick: (savings: (typeof buckets)[number]['savings']) => number) =>
          Number(buckets.reduce((total, bucket) => total + pick(bucket.savings), 0).toFixed(3));

        expect(sum((savings) => savings.income)).toBe(0.778);
        expect(sum((savings) => savings.expenses)).toBe(1.234);
        expect(sum((savings) => savings.net)).toBe(-0.456);
      });
    });
  });

  describe('2-decimal base currency (regression guard)', () => {
    const seedTwoDecimalBook = async () => {
      const account = await helpers.createAccount({ raw: true });

      await createTransactionOn({
        accountId: account.id,
        categoryId: global.DEFAULT_CATEGORY_ID,
        amount: 1.23,
        transactionType: TRANSACTION_TYPES.expense,
      });
      await createTransactionOn({
        accountId: account.id,
        categoryId: global.DEFAULT_CATEGORY_ID,
        amount: 4.56,
        transactionType: TRANSACTION_TYPES.income,
      });

      return account;
    };

    it('keeps every report at the 2-decimal values it returned before', async () => {
      const account = await seedTwoDecimalBook();
      const categoryId = global.DEFAULT_CATEGORY_ID;

      expect(await helpers.getTotalBalance({ date: TODAY, raw: true })).toBe(3.33);

      const rows = await helpers.getBalanceHistory({ ...WINDOW, raw: true });
      expect(lastBalanceOf({ rows, accountId: account.id })).toBe(3.33);

      const spendings = await helpers.getSpendingsByCategories({ ...WINDOW, raw: true });
      expect(spendings[categoryId].amount).toBe(1.23);
      expect(await helpers.getExpensesAmountForPeriod({ ...WINDOW, raw: true })).toBe(1.23);

      const cashFlow = await helpers.getCashFlow({ ...WINDOW, granularity: 'monthly', raw: true });
      expect(cashFlow.totals).toMatchObject({ income: 4.56, expenses: 1.23, netFlow: 3.33 });

      const pivot = await helpers.getPivotReport({
        ...WINDOW,
        granularity: 'monthly',
        rowDimension: 'category',
        measure: 'expense',
        raw: true,
      });
      expect(pivot.grandTotal).toBe(1.23);

      const savings = await helpers.getCumulativeData({ ...WINDOW, metric: 'savings', raw: true });
      expect(savings.currentPeriod.total).toBe(3.33);

      const summary = await helpers.getTransactionsSummary({ accountIds: [account.id], raw: true });
      expect(summary).toEqual({ count: 2, income: 4.56, expense: 1.23, net: 3.33, transfers: 0 });

      const combined = await helpers.getCombinedBalanceHistory({ ...WINDOW, raw: true });
      expect(combined.find((row) => row.date === TODAY)!.totalBalance).toBe(3.33);

      const { points } = await helpers.getNetWorthHistory({ ...WINDOW, granularity: 'weekly', raw: true });
      expect(points.at(-1)).toMatchObject({ assetsTotal: 3.33, liabilitiesTotal: 0, netWorth: 3.33 });

      const { buckets } = await helpers.getNetWorthDrivers({ ...WINDOW, granularity: 'monthly', raw: true });
      const savingsNet = buckets.reduce((total, bucket) => total + bucket.savings.net, 0);
      expect(Number(savingsNet.toFixed(2))).toBe(3.33);
    });
  });
});
