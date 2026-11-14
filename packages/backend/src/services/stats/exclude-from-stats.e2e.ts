import { TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, format, subDays } from 'date-fns';

/**
 * A flagged row stays in the ledger and out of the reports. Every report that reads the shared
 * transaction rows must agree on that, so the aggregation entry points are asserted here.
 */

const RANGE = () => ({
  from: format(subDays(new Date(), 10), 'yyyy-MM-dd'),
  to: format(addDays(new Date(), 20), 'yyyy-MM-dd'),
});

const sumAmounts = (result: Record<string, { amount: number }>) =>
  Object.values(result).reduce((acc, curr) => acc + curr.amount, 0);

const sumTotals = (result: { totals: { income: number; expenses: number } }) => result.totals;

const seed = async () => {
  const account = await helpers.createAccount({ raw: true });
  const time = subDays(new Date(), 1).toISOString();

  const tx = async ({
    amount,
    transactionType,
    excludeFromStats,
  }: {
    amount: number;
    transactionType: TRANSACTION_TYPES;
    excludeFromStats?: boolean;
  }) => {
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: account.id, amount, transactionType }),
        time,
        ...(excludeFromStats === undefined ? {} : { excludeFromStats }),
      },
      raw: true,
    });
  };

  await tx({ amount: 50, transactionType: TRANSACTION_TYPES.expense });
  await tx({ amount: 200, transactionType: TRANSACTION_TYPES.expense, excludeFromStats: true });
  await tx({ amount: 100, transactionType: TRANSACTION_TYPES.income });

  return account;
};

describe('excludeFromStats on stats endpoints', () => {
  it('GET /stats/cash-flow drops the flagged expense and keeps the income', async () => {
    await seed();

    const result = await helpers.getCashFlow({ ...RANGE(), granularity: 'monthly', raw: true });

    expect(sumTotals(result)).toMatchObject({ income: 100, expenses: 50 });
  }, 60_000);

  it('GET /stats/spendings-by-categories drops the flagged expense', async () => {
    await seed();

    const result = await helpers.getSpendingsByCategories({ ...RANGE(), raw: true });

    expect(sumAmounts(result)).toBe(50);
  }, 60_000);

  it('GET /stats/expenses-amount-for-period drops the flagged expense', async () => {
    await seed();

    const result = await helpers.getExpensesAmountForPeriod({ ...RANGE(), raw: true });

    expect(result).toBe(50);
  }, 60_000);

  it('the flagged row is still listed and still counts toward the account balance', async () => {
    const account = await seed();

    const listed = await helpers.getTransactions({ raw: true });
    const flagged = listed.filter((tx) => tx.excludeFromStats);

    expect(flagged).toHaveLength(1);

    const balance = await helpers.getBalanceHistory({ ...RANGE(), accountId: account.id, raw: true });
    expect(balance.length).toBeGreaterThan(0);
  }, 60_000);

  it('drops the whole refund pair when the original is excluded', async () => {
    const account = await helpers.createAccount({ raw: true });
    const time = subDays(new Date(), 1).toISOString();

    const [expense] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        time,
      },
      raw: true,
    });
    const [refund] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.income,
        }),
        time,
      },
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expense.id, refundTxId: refund.id });

    // The refund takes 50 off the 200 expense, so the pair is worth 150 until one side is excluded.
    expect(await helpers.getExpensesAmountForPeriod({ ...RANGE(), raw: true })).toBe(150);

    await helpers.updateTransaction({ id: expense.id, payload: { excludeFromStats: true } });

    expect(await helpers.getExpensesAmountForPeriod({ ...RANGE(), raw: true })).toBe(0);
  }, 60_000);

  it('drops the whole refund pair when the refund side is excluded', async () => {
    const account = await helpers.createAccount({ raw: true });
    const time = subDays(new Date(), 1).toISOString();

    const [expense] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        time,
      },
      raw: true,
    });
    const [refund] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.income,
        }),
        time,
      },
      raw: true,
    });
    await helpers.createSingleRefund({ originalTxId: expense.id, refundTxId: refund.id });

    expect(await helpers.getExpensesAmountForPeriod({ ...RANGE(), raw: true })).toBe(150);

    await helpers.updateTransaction({ id: refund.id, payload: { excludeFromStats: true } });

    expect(await helpers.getExpensesAmountForPeriod({ ...RANGE(), raw: true })).toBe(0);
  }, 60_000);

  it('keeps the flagged row out of the tracker totals', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [expense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const tracker = await helpers.createTracker({ name: 'gifts', raw: true });
    await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [expense.id] } });

    const before = await helpers.getTrackerStats({ id: tracker.id, raw: true });
    expect(before?.summary.actualExpense).toBe(10000);

    await helpers.updateTransaction({ id: expense.id, payload: { excludeFromStats: true } });

    const after = await helpers.getTrackerStats({ id: tracker.id, raw: true });
    expect(after?.summary.actualExpense).toBe(0);
  }, 60_000);

  it('keeps the flagged row out of the budget plan activity', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: 'Gifts', color: '#111111', raw: true });
    const { plan } = await helpers.createBudgetPlan({
      payload: { accountIds: [account.id], epochDate: helpers.budgetPeriodStart({ monthsAgo: 2 }) },
      raw: true,
    });
    const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
    const period = periods[0]!;
    await helpers.createBudgetPlanLine({
      planId: plan.id,
      payload: { name: 'Gifts', categoryIds: [category.id], activeFrom: period.startDate },
      raw: true,
    });

    const [expense] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        time: new Date(Date.parse(`${period.startDate}T00:00:00.000Z`) + 720 * 60_000).toISOString(),
      },
      raw: true,
    });

    const before = await helpers.getBudgetPlanPeriodView({ planId: plan.id, periodId: period.id, raw: true });
    expect(before.lines[0]?.activity).toBe(-100);

    await helpers.updateTransaction({ id: expense.id, payload: { excludeFromStats: true } });

    const after = await helpers.getBudgetPlanPeriodView({ planId: plan.id, periodId: period.id, raw: true });
    expect(after.lines[0]?.activity).toBe(0);
  }, 60_000);
});
