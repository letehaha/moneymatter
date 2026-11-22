import {
  ACCOUNT_CATEGORIES,
  DEPRECIATION_PRESET,
  type RecordId,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, format, subDays, subYears } from 'date-fns';

/**
 * The stats reports compute in integer minor units at the base currency's decimals, so a
 * KWD-base user (3 decimals) and a JPY-base user (0 decimals) get the same exact amounts that are
 * stored. The 2-decimal block below runs the same flow for the primary user and keeps today's
 * values.
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

interface BookSpec {
  baseCode: string;
  decimals: number;
  foreignCode: string;
  /** Manual rate from the foreign currency into the base currency. */
  rate: number;
  /** Expense entered on the base-currency account. */
  expense: number;
  /** Income entered on the foreign-currency account. */
  foreignIncome: number;
  /** What the report should show: the income converted and rounded half-even, and the net. */
  expected: { expense: number; income: number; net: number };
}

/**
 * KWD-base book: a KWD expense of 1.234 and a JPY income of 1555 that converts to
 * 1555 * 0.0005 = 0.7775, which half-even rounds to 0.778 at 3 decimals.
 */
const KWD_BOOK: BookSpec = {
  baseCode: 'KWD',
  decimals: 3,
  foreignCode: 'JPY',
  rate: 0.0005,
  expense: 1.234,
  foreignIncome: 1555,
  expected: { expense: 1.234, income: 0.778, net: -0.456 },
};

/**
 * JPY-base book: a JPY expense of 1500 and a KWD income of 1.233 that converts to
 * 1.233 * 2500 = 3082.5, a tie that half-even rounds to 3082 at 0 decimals (half-up would give 3083).
 */
const JPY_BOOK: BookSpec = {
  baseCode: 'JPY',
  decimals: 0,
  foreignCode: 'KWD',
  rate: 2500,
  expense: 1500,
  foreignIncome: 1.233,
  expected: { expense: 1500, income: 3082, net: 1582 },
};

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

const seedBook = async ({ spec }: { spec: BookSpec }): Promise<Book> => {
  const { baseCode, foreignCode, rate } = spec;

  await helpers.addUserCurrencies({ currencyCodes: [baseCode, foreignCode], raw: true });
  const category = await helpers.addCustomCategory({ name: 'Precision', color: '#AABBCC', raw: true });
  const baseAccount = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: baseCode }),
    raw: true,
  });
  const foreignAccount = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: foreignCode }),
    raw: true,
  });
  await helpers.updateUserCurrency({ currency: { currencyCode: foreignCode, liveRateUpdate: false }, raw: true });
  await helpers.editCurrencyExchangeRate({
    pairs: [
      { baseCode: foreignCode, quoteCode: baseCode, rate },
      { baseCode, quoteCode: foreignCode, rate: 1 / rate },
    ],
  });

  await createTransactionOn({
    accountId: baseAccount.id,
    categoryId: category.id,
    amount: spec.expense,
    transactionType: TRANSACTION_TYPES.expense,
  });
  await createTransactionOn({
    accountId: foreignAccount.id,
    categoryId: category.id,
    amount: spec.foreignIncome,
    transactionType: TRANSACTION_TYPES.income,
  });

  return { baseAccountId: baseAccount.id, foreignAccountId: foreignAccount.id, categoryId: category.id };
};

const inBook = ({ spec, fn }: { spec: BookSpec; fn: (book: Book) => Promise<void> }) =>
  helpers.asNewUserWithBaseCurrency({ currencyCode: spec.baseCode, fn: async () => fn(await seedBook({ spec })) });

const inKwdBook = (fn: (book: Book) => Promise<void>) => inBook({ spec: KWD_BOOK, fn });

/** The last balance row an account carries in the window, as the chart reads it. */
const lastBalanceOf = ({ rows, accountId }: { rows: { accountId: string; amount: unknown }[]; accountId: RecordId }) =>
  Number(rows.filter((row) => row.accountId === accountId).at(-1)!.amount);

/** Sums float API decimals and trims the float noise at the currency's decimals. */
const sumAt = ({ values, decimals }: { values: number[]; decimals: number }) =>
  Number(values.reduce((total, value) => total + value, 0).toFixed(decimals));

describe('Stats in the base currency decimals', () => {
  describe.each([
    { title: 'KWD base currency (3 decimals)', spec: KWD_BOOK },
    { title: 'JPY base currency (0 decimals)', spec: JPY_BOOK },
  ])('$title', ({ spec }) => {
    const { expense, income, net } = spec.expected;
    const { decimals } = spec;
    const inThisBook = (fn: (book: Book) => Promise<void>) => inBook({ spec, fn });

    it('reports balances, balance history, net worth and drivers at the base decimals', async () => {
      await inThisBook(async ({ baseAccountId, foreignAccountId }) => {
        expect(await helpers.getTotalBalance({ date: TODAY, raw: true })).toBe(net);

        const rows = await helpers.getBalanceHistory({ ...WINDOW, raw: true });
        expect(lastBalanceOf({ rows, accountId: baseAccountId })).toBe(-expense);
        expect(lastBalanceOf({ rows, accountId: foreignAccountId })).toBe(income);

        const combined = await helpers.getCombinedBalanceHistory({ ...WINDOW, raw: true });
        const today = combined.find((row) => row.date === TODAY)!;
        expect(today.accountsBalance).toBe(net);
        expect(today.totalBalance).toBe(net);

        const { points } = await helpers.getNetWorthHistory({ ...WINDOW, granularity: 'weekly', raw: true });
        const last = points.at(-1)!;
        expect(last.assets.cash).toBe(income);
        expect(last.assetsTotal).toBe(income);
        expect(last.liabilitiesTotal).toBe(-expense);
        expect(last.netWorth).toBe(net);

        const { buckets } = await helpers.getNetWorthDrivers({ ...WINDOW, granularity: 'monthly', raw: true });
        const sum = (pick: (savings: (typeof buckets)[number]['savings']) => number) =>
          sumAt({ values: buckets.map((bucket) => pick(bucket.savings)), decimals });
        expect(sum((savings) => savings.income)).toBe(income);
        expect(sum((savings) => savings.expenses)).toBe(expense);
        expect(sum((savings) => savings.net)).toBe(net);
      });
    });

    it('reports category spendings, cash flow, pivot, cumulative and summary at the base decimals', async () => {
      await inThisBook(async ({ baseAccountId, foreignAccountId, categoryId }) => {
        const spendings = await helpers.getSpendingsByCategories({ ...WINDOW, raw: true });
        const incomes = await helpers.getSpendingsByCategories({
          ...WINDOW,
          type: TRANSACTION_TYPES.income,
          raw: true,
        });
        const byType = await helpers.getSpendingsByCategories({ ...WINDOW, groupByType: true, raw: true });
        expect(spendings[categoryId].amount).toBe(expense);
        expect(incomes[categoryId].amount).toBe(income);
        expect(byType[categoryId]).toMatchObject({ income, expense });
        expect(await helpers.getExpensesAmountForPeriod({ ...WINDOW, raw: true })).toBe(expense);

        const months = await helpers.getMonthlySpendingsByCategories({ ...WINDOW, raw: true });
        const inCategory = months.map((month) => month.categories[categoryId]).filter(Boolean);
        expect(sumAt({ values: inCategory.map((entry) => entry!.expense), decimals })).toBe(expense);
        expect(sumAt({ values: inCategory.map((entry) => entry!.income), decimals })).toBe(income);

        const cashFlow = await helpers.getCashFlow({ ...WINDOW, granularity: 'monthly', raw: true });
        expect(cashFlow.totals).toMatchObject({ income, expenses: expense, netFlow: net });
        expect(sumAt({ values: cashFlow.periods.map((period) => period.income), decimals })).toBe(income);

        const pivotOf = ({
          rowDimension,
          measure,
        }: {
          rowDimension: 'category' | 'payee';
          measure: 'expense' | 'income';
        }) => helpers.getPivotReport({ ...WINDOW, granularity: 'monthly', rowDimension, measure, raw: true });
        const expensePivot = await pivotOf({ rowDimension: 'category', measure: 'expense' });
        expect(expensePivot.grandTotal).toBe(expense);
        expect(expensePivot.rows.find((row) => row.id === categoryId)!.total).toBe(expense);
        expect((await pivotOf({ rowDimension: 'category', measure: 'income' })).grandTotal).toBe(income);
        expect((await pivotOf({ rowDimension: 'payee', measure: 'income' })).grandTotal).toBe(income);

        const cumulativeExpenses = await helpers.getCumulativeData({ ...WINDOW, metric: 'expenses', raw: true });
        const cumulativeSavings = await helpers.getCumulativeData({ ...WINDOW, metric: 'savings', raw: true });
        expect(cumulativeExpenses.currentPeriod.total).toBe(expense);
        expect(cumulativeSavings.currentPeriod.total).toBe(net);

        const summary = await helpers.getTransactionsSummary({
          accountIds: [baseAccountId, foreignAccountId],
          raw: true,
        });
        expect(summary).toEqual({ count: 2, income, expense, net, transfers: 0 });
      });
    });
  });

  describe('KWD base currency (3 decimals): splits, refunds, tags and contributions', () => {
    it('nets a split and a partial cross-currency refund at 3 decimals', async () => {
      await inKwdBook(async ({ baseAccountId, foreignAccountId, categoryId }) => {
        const primary = await helpers.addCustomCategory({ name: 'Split primary', color: '#112233', raw: true });
        const splitTarget = await helpers.addCustomCategory({ name: 'Split target', color: '#332211', raw: true });

        // 2.468 KWD, of which 1.111 goes to the split category and 1.357 stays on the primary one.
        const [purchase] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: baseAccountId,
            categoryId: primary.id,
            amount: 2.468,
            transactionType: TRANSACTION_TYPES.expense,
            time: TIME,
            splits: [{ categoryId: splitTarget.id, amount: 1.111 }],
          }),
          raw: true,
        });
        // 1997 JPY * 0.0005 = 0.9985, a tie that half-even rounds to 0.998 KWD.
        const [refund] = await createTransactionOn({
          accountId: foreignAccountId,
          categoryId: primary.id,
          amount: 1997,
          transactionType: TRANSACTION_TYPES.income,
        });
        // 1234 of the refund's 1997 JPY link back: 0.998 * 1234 / 1997 = 0.61668..., so 0.617 KWD.
        const link = await helpers.createSingleRefund({
          originalTxId: purchase!.id,
          refundTxId: refund!.id,
          amount: 1234,
        });
        expect(link.statusCode).toBe(200);

        const cashFlow = await helpers.getCashFlow({ ...WINDOW, granularity: 'monthly', raw: true });
        // Expenses 1.234 + 2.468 - 0.617; income 0.778 + 0.998 - 0.617.
        expect(cashFlow.totals).toMatchObject({ expenses: 3.085, income: 1.159, netFlow: -1.926 });

        const categories = cashFlow.periods.flatMap((period) => period.categories ?? []);
        const amountsOf = ({ id }: { id: RecordId }) => {
          const entries = categories.filter((entry) => entry.categoryId === id);
          return {
            expense: sumAt({ values: entries.map((entry) => entry.expenseAmount), decimals: 3 }),
            income: sumAt({ values: entries.map((entry) => entry.incomeAmount), decimals: 3 }),
          };
        };
        expect(amountsOf({ id: primary.id })).toEqual({ expense: 0.74, income: 0.381 });
        expect(amountsOf({ id: splitTarget.id })).toEqual({ expense: 1.111, income: 0 });
        expect(amountsOf({ id: categoryId })).toEqual({ expense: 1.234, income: 0.778 });

        const spendings = await helpers.getSpendingsByCategories({ ...WINDOW, raw: true });
        expect(spendings[primary.id].amount).toBe(0.74);
        expect(spendings[splitTarget.id].amount).toBe(1.111);

        const months = await helpers.getMonthlySpendingsByCategories({ ...WINDOW, raw: true });
        const monthlyOf = ({ id }: { id: RecordId }) =>
          sumAt({ values: months.map((month) => month.categories[id]?.expense ?? 0), decimals: 3 });
        expect(monthlyOf({ id: primary.id })).toBe(0.74);
        expect(monthlyOf({ id: splitTarget.id })).toBe(1.111);

        const pivot = await helpers.getPivotReport({
          ...WINDOW,
          granularity: 'monthly',
          rowDimension: 'category',
          measure: 'expense',
          raw: true,
        });
        expect(pivot.rows.find((row) => row.id === primary.id)!.total).toBe(0.74);
        expect(pivot.rows.find((row) => row.id === splitTarget.id)!.total).toBe(1.111);
        expect(pivot.grandTotal).toBe(3.085);

        // -1.234 - 2.468 on the KWD account; 0.778 + 0.998 on the JPY one.
        expect(await helpers.getTotalBalance({ date: TODAY, raw: true })).toBe(-1.926);
      });
    });

    it('reports tag and subcategory pivot rows at 3 decimals', async () => {
      await inKwdBook(async ({ baseAccountId, foreignAccountId, categoryId }) => {
        const parent = await helpers.addCustomCategory({ name: 'Precision parent', color: '#445566', raw: true });
        const child = await helpers.addCustomCategory({
          name: 'Precision child',
          color: '#665544',
          parentId: parent.id,
          raw: true,
        });
        const tag = await helpers.createTag({ payload: { name: 'Precision tag', color: '#AA0000' }, raw: true });

        await createTransactionOn({
          accountId: baseAccountId,
          categoryId: parent.id,
          amount: 0.125,
          transactionType: TRANSACTION_TYPES.expense,
        });
        // 2005 JPY * 0.0005 = 1.0025, a tie that half-even rounds to 1.002 KWD.
        const [tagged] = await createTransactionOn({
          accountId: foreignAccountId,
          categoryId: child.id,
          amount: 2005,
          transactionType: TRANSACTION_TYPES.expense,
        });
        await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [tagged!.id], raw: true });

        const byTag = await helpers.getPivotReport({
          ...WINDOW,
          granularity: 'monthly',
          rowDimension: 'tag',
          measure: 'expense',
          raw: true,
        });
        expect(byTag.rows.find((row) => row.id === tag.id)!.total).toBe(1.002);
        expect(byTag.rows.find((row) => row.id === 'untagged')!.total).toBe(1.359);
        expect(byTag.grandTotal).toBe(2.361);

        const bySubcategory = await helpers.getPivotReport({
          ...WINDOW,
          granularity: 'monthly',
          rowDimension: 'subcategory',
          measure: 'expense',
          raw: true,
        });
        expect(bySubcategory.rows.find((row) => row.id === parent.id)!.total).toBe(1.127);
        expect(bySubcategory.rows.find((row) => row.id === child.id)!.total).toBe(1.002);
        expect(bySubcategory.rows.find((row) => row.id === categoryId)!.total).toBe(1.234);
        expect(bySubcategory.grandTotal).toBe(2.361);
      });
    });

    it('subtracts a converted credit limit at 3 decimals', async () => {
      await inKwdBook(async () => {
        // 200005 JPY * 0.0005 = 100.0025, a tie that half-even rounds to 100.002 KWD.
        await helpers.createAccount({
          payload: helpers.buildAccountPayload({
            currencyCode: 'JPY',
            accountCategory: ACCOUNT_CATEGORIES.creditCard,
            initialBalance: 0,
            creditLimit: 200005,
          }),
          raw: true,
        });

        expect(await helpers.getTotalBalance({ date: TODAY, raw: true })).toBe(-0.456);

        await helpers.updateUserSettings({ raw: true, settings: { locale: 'en', includeCreditLimitInStats: true } });

        expect(await helpers.getTotalBalance({ date: TODAY, raw: true })).toBe(-100.458);
      });
    });

    it('reports investment contributions and net worth at 3 decimals', async () => {
      await inKwdBook(async () => {
        const portfolio = await helpers.createPortfolio({ payload: { name: 'Precision portfolio' }, raw: true });
        await helpers.directCashTransaction({
          portfolioId: portfolio.id,
          payload: { type: 'deposit', amount: '12.345', currencyCode: 'KWD', date: TODAY },
          raw: true,
        });

        const { buckets } = await helpers.getInvestmentContributions({ ...WINDOW, granularity: 'monthly', raw: true });

        expect(sumAt({ values: buckets.map((bucket) => bucket.total), decimals: 3 })).toBe(12.345);
        expect(
          sumAt({
            values: buckets.flatMap((bucket) => bucket.byPortfolio.map((slice) => slice.amount)),
            decimals: 3,
          }),
        ).toBe(12.345);

        const { points } = await helpers.getNetWorthHistory({ ...WINDOW, granularity: 'weekly', raw: true });
        expect(points.at(-1)!.assets.investments).toBe(12.345);
      });
    });

    it('reports venture contributions and net worth at 3 decimals', async () => {
      await inKwdBook(async ({ baseAccountId, categoryId }) => {
        const deal = await helpers.createVentureDeal({
          payload: {
            name: 'Precision deal',
            currencyCode: 'KWD',
            principal: '2.469',
            entryFeePct: '0',
            investmentDate: TODAY,
          },
          raw: true,
        });
        const [investment] = await createTransactionOn({
          accountId: baseAccountId,
          categoryId,
          amount: 2.469,
          transactionType: TRANSACTION_TYPES.expense,
        });
        const event = await helpers.createVentureEvent({
          dealId: deal.id,
          payload: {
            type: VENTURE_EVENT_TYPE.initial_investment,
            eventDate: TODAY,
            cashFlowMode: VENTURE_CASH_FLOW_MODE.linked,
            transactionIds: [investment!.id],
          },
        });
        expect(event.statusCode).toBe(200);

        const contributions = await helpers.getVentureContributions({ ...WINDOW, raw: true });

        expect(contributions).toEqual([{ dealId: deal.id, name: 'Precision deal', amount: 2.469 }]);

        const { points } = await helpers.getNetWorthHistory({ ...WINDOW, granularity: 'weekly', raw: true });
        expect(points.at(-1)!.assets.ventures).toBe(2.469);
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

  describe('vehicle value', () => {
    const buyVehicle = ({ currencyCode, purchasePrice }: { currencyCode: string; purchasePrice: number }) =>
      helpers.createVehicle({
        name: 'Precision car',
        currencyCode,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        vehicleClass: VEHICLE_CLASS.sedan,
        purchasePrice,
        purchaseDate: TODAY,
        raw: true,
      });

    const todayVehiclesBalance = async () => {
      const rows = await helpers.getCombinedBalanceHistory({ ...WINDOW, raw: true });

      return rows.find((row) => row.date === TODAY)!.vehiclesBalance;
    };

    it.each([
      {
        title: 'a KWD vehicle at 3 decimals for a KWD-base user',
        base: 'KWD',
        vehicleCurrency: 'KWD',
        purchasePrice: 5000.125,
        expected: 5000.125,
      },
      // 5000.125 * 3.25 = 16250.40625
      {
        title: 'a KWD vehicle converted into a USD base',
        base: 'USD',
        vehicleCurrency: 'KWD',
        rate: 3.25,
        purchasePrice: 5000.125,
        expected: 16250.41,
      },
      {
        title: 'a JPY vehicle converted into a KWD base',
        base: 'KWD',
        vehicleCurrency: 'JPY',
        rate: 0.0005,
        purchasePrice: 1000000,
        expected: 500,
      },
      // 1001 * 0.005 = 5.005, a tie that rounds half-even to 5.00
      {
        title: 'a JPY vehicle converted into a USD base on a rounding tie',
        base: 'USD',
        vehicleCurrency: 'JPY',
        rate: 0.005,
        purchasePrice: 1001,
        expected: 5,
      },
    ])('reports $title', async ({ base, vehicleCurrency, rate, purchasePrice, expected }) => {
      await helpers.asNewUserWithBaseCurrency({
        currencyCode: base,
        fn: async () => {
          if (rate) {
            await helpers.addUserCurrencies({ currencyCodes: [vehicleCurrency], raw: true });
            await helpers.updateUserCurrency({
              currency: { currencyCode: vehicleCurrency, liveRateUpdate: false },
              raw: true,
            });
            await helpers.editCurrencyExchangeRate({
              pairs: [
                { baseCode: vehicleCurrency, quoteCode: base, rate },
                { baseCode: base, quoteCode: vehicleCurrency, rate: 1 / rate },
              ],
            });
          }
          await buyVehicle({ currencyCode: vehicleCurrency, purchasePrice });

          expect(await todayVehiclesBalance()).toBe(expected);

          // A range ending today reads user rates up to today's midnight, so a rate set today is not seen.
          if (rate) return;
          const { points } = await helpers.getNetWorthHistory({
            from: FROM,
            to: TODAY,
            granularity: 'weekly',
            raw: true,
          });
          expect(points.at(-1)!.assets.vehicles).toBe(expected);
        },
      });
    });

    it('reports a depreciated JPY vehicle in whole yen for a JPY-base user', async () => {
      await helpers.asNewUserWithBaseCurrency({
        currencyCode: 'JPY',
        fn: async () => {
          await helpers.createVehicle({
            name: 'Precision car',
            currencyCode: 'JPY',
            make: 'Toyota',
            model: 'Camry',
            year: 2020,
            vehicleClass: VEHICLE_CLASS.sedan,
            purchasePrice: 1_234_567,
            purchaseDate: format(subYears(NOW, 2), 'yyyy-MM-dd'),
            depreciationPreset: DEPRECIATION_PRESET.custom,
            customAnnualRatePct: 10,
            raw: true,
          });

          // Two years at 10% leave 999_999.27, held as 999_999.
          expect(await todayVehiclesBalance()).toBe(999_999);
        },
      });
    });

    it('keeps 3 decimals in the anchor a KWD override creates', async () => {
      await helpers.asNewUserWithBaseCurrency({
        currencyCode: 'KWD',
        fn: async () => {
          const vehicle = await buyVehicle({ currencyCode: 'KWD', purchasePrice: 5000.125 });

          await helpers.overrideVehicleValue({ id: vehicle.id, accountId: vehicle.accountId, targetValue: 5000.13 });

          expect(await todayVehiclesBalance()).toBe(5000.13);
        },
      });
    });
  });
});

describe('Stats for a user without a base currency', () => {
  it('answers the reports with zeros instead of an error', async () => {
    const { cookies } = await helpers.signUpSecondUser();

    const { expenses, summary, totalBalance, combined } = await helpers.asUser({
      cookies,
      fn: async () => ({
        expenses: await helpers.getExpensesAmountForPeriod(WINDOW),
        summary: await helpers.getTransactionsSummary(),
        totalBalance: await helpers.getTotalBalance({ date: TODAY }),
        combined: await helpers.getCombinedBalanceHistory(WINDOW),
      }),
    });

    expect(totalBalance.statusCode).toBe(200);
    expect(helpers.extractResponse(totalBalance)).toBe(0);
    expect(combined.statusCode).toBe(200);
    expect(expenses.statusCode).toBe(200);
    expect(helpers.extractResponse(expenses)).toBe(0);
    expect(summary.statusCode).toBe(200);
    expect(helpers.extractResponse(summary)).toEqual({ count: 0, income: 0, expense: 0, net: 0, transfers: 0 });
  });
});
