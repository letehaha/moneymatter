import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const uniqueName = (prefix: string): string => `${prefix}-${generateRandomRecordId()}`;

const createTx = async ({
  accountId,
  amount,
  transactionType,
  categoryId,
  time,
  payeeId,
  splits,
}: {
  accountId: RecordId;
  amount: number;
  transactionType: TRANSACTION_TYPES;
  categoryId: RecordId;
  time?: string;
  payeeId?: RecordId;
  splits?: { categoryId: RecordId; amount: number }[];
}) => {
  const [tx] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId,
        amount,
        transactionType,
        categoryId,
        payeeId,
        ...(splits ? { splits } : {}),
      }),
      ...(time ? { time } : {}),
    },
    raw: true,
  });
  return tx!;
};

const createCategory = (prefix: string) =>
  helpers.addCustomCategory({ name: uniqueName(prefix), color: '#123456', raw: true });

/** A 100 purchase in A and a 100 purchase in B, both partly refunded (30 / 20) by one 50 income. */
const setupSplitRefund = async ({
  purchaseTime,
  refundTime,
  payeeIdA,
  payeeIdB,
}: { purchaseTime?: string; refundTime?: string; payeeIdA?: RecordId; payeeIdB?: RecordId } = {}) => {
  const account = await helpers.createAccount({ raw: true });
  const [categoryA, categoryB, refundCategory] = await Promise.all([
    createCategory('A'),
    createCategory('B'),
    createCategory('Refund'),
  ]);

  const purchaseA = await createTx({
    accountId: account.id,
    amount: 100,
    transactionType: TRANSACTION_TYPES.expense,
    categoryId: categoryA.id,
    time: purchaseTime,
    payeeId: payeeIdA,
  });
  const purchaseB = await createTx({
    accountId: account.id,
    amount: 100,
    transactionType: TRANSACTION_TYPES.expense,
    categoryId: categoryB.id,
    time: purchaseTime,
    payeeId: payeeIdB,
  });
  const refund = await createTx({
    accountId: account.id,
    amount: 50,
    transactionType: TRANSACTION_TYPES.income,
    categoryId: refundCategory.id,
    time: refundTime,
  });

  await helpers.createSingleRefund({ originalTxId: purchaseA.id, refundTxId: refund.id, amount: 30 }, true);
  await helpers.createSingleRefund({ originalTxId: purchaseB.id, refundTxId: refund.id, amount: 20 }, true);

  return { categoryA, categoryB, refundCategory, purchaseA, purchaseB, refund };
};

/** A 1000 UAH refund at a 0.1 UAH->base rate, split 600 / 400 across two base-currency purchases. */
const setupForeignRefund = async () => {
  const { account: uahAccount, currency } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });
  await helpers.editUserCurrencyExchangeRate({
    pairs: [
      { baseCode: currency.code, quoteCode: global.BASE_CURRENCY!.code, rate: 0.1 },
      { baseCode: global.BASE_CURRENCY!.code, quoteCode: currency.code, rate: 10 },
    ],
  });
  const account = await helpers.createAccount({ raw: true });
  const [categoryA, categoryB, refundCategory] = await Promise.all([
    createCategory('A'),
    createCategory('B'),
    createCategory('Refund'),
  ]);

  const purchaseA = await createTx({
    accountId: account.id,
    amount: 100,
    transactionType: TRANSACTION_TYPES.expense,
    categoryId: categoryA.id,
  });
  const purchaseB = await createTx({
    accountId: account.id,
    amount: 100,
    transactionType: TRANSACTION_TYPES.expense,
    categoryId: categoryB.id,
  });
  const refund = await createTx({
    accountId: uahAccount.id,
    amount: 1000,
    transactionType: TRANSACTION_TYPES.income,
    categoryId: refundCategory.id,
  });

  await helpers.createSingleRefund({ originalTxId: purchaseA.id, refundTxId: refund.id, amount: 600 }, true);
  await helpers.createSingleRefund({ originalTxId: purchaseB.id, refundTxId: refund.id, amount: 400 }, true);

  // Base-currency value of each share, rounded to cents like the server does.
  const shareA = Math.round(Number(refund.refAmount) * 100 * 0.6) / 100;
  const shareB = Math.round(Number(refund.refAmount) * 100 * 0.4) / 100;

  return { categoryA, categoryB, refund, shareA, shareB };
};

/** A 100 purchase refunded by a 50 income of which only 30 is assigned to it. */
const setupPartlyAssignedRefund = async ({
  purchaseTime,
  refundTime,
}: {
  purchaseTime: string;
  refundTime: string;
}) => {
  const account = await helpers.createAccount({ raw: true });
  const [category, refundCategory] = await Promise.all([createCategory('A'), createCategory('Refund')]);

  const purchase = await createTx({
    accountId: account.id,
    amount: 100,
    transactionType: TRANSACTION_TYPES.expense,
    categoryId: category.id,
    time: purchaseTime,
  });
  const refund = await createTx({
    accountId: account.id,
    amount: 50,
    transactionType: TRANSACTION_TYPES.income,
    categoryId: refundCategory.id,
    time: refundTime,
  });
  await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: refund.id, amount: 30 }, true);

  return { category, refundCategory };
};

describe('Partial refund netting', () => {
  it('spendings-by-categories nets each share against its own purchase category', async () => {
    const { categoryA, categoryB, refundCategory } = await setupSplitRefund();

    const result = await helpers.getSpendingsByCategories({
      raw: true,
      groupByType: true,
      categoryIds: [categoryA.id, categoryB.id, refundCategory.id],
    });

    expect(result[categoryA.id.toString()]).toMatchObject({ income: 0, expense: 70 });
    expect(result[categoryB.id.toString()]).toMatchObject({ income: 0, expense: 80 });
  });

  it('pivot nets each share against its own purchase category', async () => {
    const { categoryA, categoryB } = await setupSplitRefund({
      purchaseTime: '2025-01-10T12:00:00.000Z',
      refundTime: '2025-01-20T12:00:00.000Z',
    });

    const result = await helpers.getPivotReport({
      from: '2025-01-01',
      to: '2025-01-31',
      granularity: 'monthly',
      rowDimension: 'category',
      measure: 'expense',
      categoryIds: [categoryA.id, categoryB.id],
      raw: true,
    });

    expect(result.rows.find((row) => row.id === categoryA.id)!.total).toBe(70);
    expect(result.rows.find((row) => row.id === categoryB.id)!.total).toBe(80);
  });

  it('pivot nets each share against its own purchase payee', async () => {
    const payeeA = await helpers.createPayee({ payload: { name: uniqueName('PayeeA') }, raw: true });
    const payeeB = await helpers.createPayee({ payload: { name: uniqueName('PayeeB') }, raw: true });
    await setupSplitRefund({
      purchaseTime: '2025-01-10T12:00:00.000Z',
      refundTime: '2025-01-20T12:00:00.000Z',
      payeeIdA: payeeA.id,
      payeeIdB: payeeB.id,
    });

    const result = await helpers.getPivotReport({
      from: '2025-01-01',
      to: '2025-01-31',
      granularity: 'monthly',
      rowDimension: 'payee',
      measure: 'expense',
      payeeIds: [payeeA.id, payeeB.id],
      raw: true,
    });

    expect(result.rows.find((row) => row.id === payeeA.id)!.total).toBe(70);
    expect(result.rows.find((row) => row.id === payeeB.id)!.total).toBe(80);
  });

  it('spendings-by-categories nets the base-currency value of a foreign-currency refund share', async () => {
    const { categoryA, categoryB, refund, shareA, shareB } = await setupForeignRefund();

    expect(refund.refAmount).not.toBe(refund.amount);

    const result = await helpers.getSpendingsByCategories({
      raw: true,
      groupByType: true,
      categoryIds: [categoryA.id, categoryB.id],
    });

    expect(result[categoryA.id.toString()]!.expense).toBeCloseTo(100 - shareA, 2);
    expect(result[categoryB.id.toString()]!.expense).toBeCloseTo(100 - shareB, 2);
  });

  it('cash flow nets each share against its own purchase category', async () => {
    const { categoryA, categoryB } = await setupSplitRefund({
      purchaseTime: '2025-01-10T12:00:00.000Z',
      refundTime: '2025-01-20T12:00:00.000Z',
    });

    const result = await helpers.getCashFlow({
      from: '2025-01-01',
      to: '2025-01-31',
      granularity: 'monthly',
      raw: true,
    });

    const period = result.periods[0]!;
    expect(period.expenses).toBe(150);
    expect(period.income).toBe(0);
    expect(period.categories!.find((entry) => entry.categoryId === categoryA.id)!.expenseAmount).toBe(70);
    expect(period.categories!.find((entry) => entry.categoryId === categoryB.id)!.expenseAmount).toBe(80);
  });

  it('cumulative data nets both shares out of expenses and keeps the refund out of income', async () => {
    await setupSplitRefund({ purchaseTime: '2026-01-10T12:00:00.000Z', refundTime: '2026-01-20T12:00:00.000Z' });
    const range = { from: '2026-01-01', to: '2026-01-31' };

    const expenses = await helpers.getCumulativeData({ ...range, metric: 'expenses', raw: true });
    const income = await helpers.getCumulativeData({ ...range, metric: 'income', raw: true });

    expect(expenses.currentPeriod.total).toBe(150);
    expect(income.currentPeriod.total).toBe(0);
  });

  it('net-worth-drivers savings nets both shares out of expenses', async () => {
    await setupSplitRefund({ purchaseTime: '2026-01-10T12:00:00.000Z', refundTime: '2026-01-20T12:00:00.000Z' });

    const { buckets } = await helpers.getNetWorthDrivers({
      from: '2026-01-01',
      to: '2026-02-28',
      granularity: 'monthly',
      raw: true,
    });

    expect(buckets[0]!.savings).toEqual({ income: 0, expenses: 150, net: -150 });
  });

  describe('refund only partly assigned to purchases', () => {
    it('cash flow nets only the assigned share and keeps the rest as income', async () => {
      const { category, refundCategory } = await setupPartlyAssignedRefund({
        purchaseTime: '2025-01-10T12:00:00.000Z',
        refundTime: '2025-01-20T12:00:00.000Z',
      });

      const result = await helpers.getCashFlow({
        from: '2025-01-01',
        to: '2025-01-31',
        granularity: 'monthly',
        raw: true,
      });

      const period = result.periods[0]!;
      expect(period.expenses).toBe(70);
      expect(period.income).toBe(20);
      expect(period.categories!.find((entry) => entry.categoryId === category.id)!.expenseAmount).toBe(70);
      expect(period.categories!.find((entry) => entry.categoryId === refundCategory.id)!.incomeAmount).toBe(20);
    });

    it('cumulative data nets only the assigned share and keeps the rest as income', async () => {
      await setupPartlyAssignedRefund({
        purchaseTime: '2026-01-10T12:00:00.000Z',
        refundTime: '2026-01-20T12:00:00.000Z',
      });
      const range = { from: '2026-01-01', to: '2026-01-31' };

      const expenses = await helpers.getCumulativeData({ ...range, metric: 'expenses', raw: true });
      const income = await helpers.getCumulativeData({ ...range, metric: 'income', raw: true });

      expect(expenses.currentPeriod.total).toBe(70);
      expect(income.currentPeriod.total).toBe(20);
    });

    it('net-worth-drivers savings nets only the assigned share and keeps the rest as income', async () => {
      await setupPartlyAssignedRefund({
        purchaseTime: '2026-01-10T12:00:00.000Z',
        refundTime: '2026-01-20T12:00:00.000Z',
      });

      const { buckets } = await helpers.getNetWorthDrivers({
        from: '2026-01-01',
        to: '2026-02-28',
        granularity: 'monthly',
        raw: true,
      });

      expect(buckets[0]!.savings).toEqual({ income: 20, expenses: 70, net: -50 });
    });
  });

  it('tracker spending stats net only the share of the purchase it contains', async () => {
    const { categoryA, purchaseA } = await setupSplitRefund();

    const tracker = await helpers.createTracker({ name: uniqueName('share-spending'), raw: true });
    await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [purchaseA.id] } });

    const result = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });

    expect(result.spendingsByCategory).toHaveLength(1);
    expect(result.spendingsByCategory[0]).toMatchObject({ categoryId: categoryA.id, amount: 70 });
  });

  it('tracker stats net only the share of the purchase it contains', async () => {
    const { purchaseA, refund } = await setupSplitRefund();

    const purchaseOnly = await helpers.createTracker({ name: uniqueName('share-purchase'), raw: true });
    await helpers.addTransactionsToTracker({ id: purchaseOnly.id, payload: { transactionIds: [purchaseA.id] } });
    const bothSides = await helpers.createTracker({ name: uniqueName('share-both'), raw: true });
    await helpers.addTransactionsToTracker({
      id: bothSides.id,
      payload: { transactionIds: [purchaseA.id, refund.id] },
    });

    const purchaseOnlyStats = (await helpers.getTrackerStats({ id: purchaseOnly.id, raw: true }))!;
    expect(purchaseOnlyStats.summary.actualExpense).toBe(70);

    // The refund side nets both of its shares (30 + 20), the purchase side only its own 30.
    const bothSidesStats = (await helpers.getTrackerStats({ id: bothSides.id, raw: true }))!;
    expect(bothSidesStats.summary.actualExpense).toBe(70);
    expect(bothSidesStats.summary.actualIncome).toBe(0);
  });

  describe('budget-plan activity', () => {
    type Period = { id: string; startDate: string; endDate: string };

    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const at = ({ period }: { period: Period }) => `${period.startDate}T12:00:00.000Z`;

    const setupPlan = async ({ extraAccountIds = [] }: { extraAccountIds?: RecordId[] } = {}) => {
      const account = await helpers.createAccount({ raw: true });
      const [food, transport] = await Promise.all([createCategory('Food'), createCategory('Transport')]);
      const { plan } = await helpers.createBudgetPlan({
        payload: {
          accountIds: [account.id, ...extraAccountIds],
          epochDate: helpers.budgetPeriodStart({ monthsAgo: 2 }),
        },
        raw: true,
      });
      const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
      await helpers.createBudgetPlanLine({
        planId: plan.id,
        payload: { name: 'Food', categoryIds: [food.id], activeFrom: periods[0]!.startDate },
        raw: true,
      });
      await helpers.createBudgetPlanLine({
        planId: plan.id,
        payload: { name: 'Transport', categoryIds: [transport.id], sortOrder: 1, activeFrom: periods[0]!.startDate },
        raw: true,
      });

      const lineActivity = async ({ period }: { period: Period }) =>
        (await helpers.getBudgetPlanPeriodView({ planId: plan.id, periodId: period.id, raw: true })).lines.map(
          (line) => [line.name, line.activity],
        );

      return { account, food, transport, periods, lineActivity };
    };

    it('credits each share to its own purchase category in the refund period', async () => {
      const { account, food, transport, periods, lineActivity } = await setupPlan();

      const purchaseFood = await createTx({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: food.id,
        time: at({ period: periods[0]! }),
      });
      const purchaseTransport = await createTx({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: transport.id,
        time: at({ period: periods[0]! }),
      });
      const refund = await createTx({
        accountId: account.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
        categoryId: transport.id,
        time: at({ period: periods[1]! }),
      });
      await helpers.createSingleRefund({ originalTxId: purchaseFood.id, refundTxId: refund.id, amount: 30 }, true);
      await helpers.createSingleRefund({ originalTxId: purchaseTransport.id, refundTxId: refund.id, amount: 20 }, true);

      expect(await lineActivity({ period: periods[1]! })).toEqual([
        ['Food', 30],
        ['Transport', 20],
      ]);
    });

    it('credits the base-currency value of each share of a foreign-currency refund', async () => {
      const { account: uahAccount, currency } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });
      await helpers.editUserCurrencyExchangeRate({
        pairs: [
          { baseCode: currency.code, quoteCode: global.BASE_CURRENCY!.code, rate: 0.1 },
          { baseCode: global.BASE_CURRENCY!.code, quoteCode: currency.code, rate: 10 },
        ],
      });
      const { account, food, transport, periods, lineActivity } = await setupPlan({ extraAccountIds: [uahAccount.id] });

      const purchaseFood = await createTx({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: food.id,
        time: at({ period: periods[0]! }),
      });
      const purchaseTransport = await createTx({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: transport.id,
        time: at({ period: periods[0]! }),
      });
      const refund = await createTx({
        accountId: uahAccount.id,
        amount: 1000,
        transactionType: TRANSACTION_TYPES.income,
        categoryId: transport.id,
        time: at({ period: periods[1]! }),
      });
      await helpers.createSingleRefund({ originalTxId: purchaseFood.id, refundTxId: refund.id, amount: 600 }, true);
      await helpers.createSingleRefund(
        { originalTxId: purchaseTransport.id, refundTxId: refund.id, amount: 400 },
        true,
      );

      expect(await lineActivity({ period: periods[1]! })).toEqual([
        ['Food', Math.round(Number(refund.refAmount) * 100 * 0.6) / 100],
        ['Transport', Math.round(Number(refund.refAmount) * 100 * 0.4) / 100],
      ]);
    });

    it('keeps the unassigned part of a refund under its own category', async () => {
      const { account, food, transport, periods, lineActivity } = await setupPlan();

      const purchase = await createTx({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: food.id,
        time: at({ period: periods[0]! }),
      });
      const refund = await createTx({
        accountId: account.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
        categoryId: transport.id,
        time: at({ period: periods[1]! }),
      });
      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: refund.id, amount: 30 }, true);

      expect(await lineActivity({ period: periods[1]! })).toEqual([
        ['Food', 30],
        ['Transport', 20],
      ]);
    });

    it('spreads a partial share over the parent and splits of a split refund', async () => {
      const { account, food, transport, periods, lineActivity } = await setupPlan();

      const purchase = await createTx({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: food.id,
        time: at({ period: periods[0]! }),
      });
      const refund = await createTx({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.income,
        categoryId: transport.id,
        time: at({ period: periods[1]! }),
        splits: [{ categoryId: food.id, amount: 40 }],
      });
      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: refund.id, amount: 50 }, true);

      // Parent 60 gives 30 and keeps 30 (Transport); split 40 gives 20 and keeps 20 (Food); both shares go to Food.
      expect(await lineActivity({ period: periods[1]! })).toEqual([
        ['Food', 70],
        ['Transport', 30],
      ]);
    });

    it('credits exactly the refund when its splits round each share unevenly', async () => {
      const { account, food, transport, periods, lineActivity } = await setupPlan();

      const purchaseFood = await createTx({
        accountId: account.id,
        amount: 10,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: food.id,
        time: at({ period: periods[0]! }),
      });
      const purchaseTransport = await createTx({
        accountId: account.id,
        amount: 10,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: transport.id,
        time: at({ period: periods[0]! }),
      });
      const refund = await createTx({
        accountId: account.id,
        amount: 10,
        transactionType: TRANSACTION_TYPES.income,
        categoryId: transport.id,
        time: at({ period: periods[1]! }),
        splits: [
          { categoryId: food.id, amount: 3.33 },
          { categoryId: transport.id, amount: 3.33 },
        ],
      });
      await helpers.createSingleRefund({ originalTxId: purchaseFood.id, refundTxId: refund.id, amount: 5 }, true);
      await helpers.createSingleRefund({ originalTxId: purchaseTransport.id, refundTxId: refund.id, amount: 5 }, true);

      // Rounding 5 of 10 per unit (3.34, 3.33, 3.33) would credit 5.01 per share; the refund's own categories keep nothing.
      expect(await lineActivity({ period: periods[1]! })).toEqual([
        ['Food', 5],
        ['Transport', 5],
      ]);
    });

    it('rounds a half-cent foreign-currency share the same way as the stats reports', async () => {
      const { account: uahAccount, currency } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });
      await helpers.editUserCurrencyExchangeRate({
        pairs: [
          { baseCode: currency.code, quoteCode: global.BASE_CURRENCY!.code, rate: 0.1 },
          { baseCode: global.BASE_CURRENCY!.code, quoteCode: currency.code, rate: 10 },
        ],
      });
      const { account, food, transport, periods, lineActivity } = await setupPlan({ extraAccountIds: [uahAccount.id] });

      const purchase = await createTx({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: food.id,
        time: at({ period: periods[0]! }),
      });
      const refund = await createTx({
        accountId: uahAccount.id,
        amount: 1000,
        transactionType: TRANSACTION_TYPES.income,
        categoryId: transport.id,
        time: at({ period: periods[1]! }),
      });
      await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: refund.id, amount: 333.35 }, true);

      // 333.35 of 1000 UAH is 33.335 in base currency, so both implementations must round half up.
      expect(Number(refund.refAmount)).toBe(100);
      expect(await lineActivity({ period: periods[1]! })).toEqual([
        ['Food', 33.34],
        ['Transport', 66.66],
      ]);

      const spendings = await helpers.getSpendingsByCategories({
        raw: true,
        groupByType: true,
        categoryIds: [food.id],
      });
      expect(spendings[food.id.toString()]!.expense).toBe(66.66);
    });
  });
});
