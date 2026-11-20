import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
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

const linkRefund = async ({ originalTxId, refundTxId }: { originalTxId: RecordId; refundTxId: RecordId }) => {
  expect((await helpers.createSingleRefund({ originalTxId, refundTxId })).statusCode).toBe(200);
};
const flagTx = async ({ id }: { id: RecordId }) => {
  await helpers.updateTransaction({ id, payload: { excludeFromStats: true } });
};

/**
 * Payee net flow is a raw signed sum with no refund netting or clamping, so a leaked group member
 * shows up in it. A 10 baseline expense keeps the payee's stats row present.
 */
const seedRefundGroup = async () => {
  const account = await helpers.createAccount({ raw: true });
  const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Group payee' }), raw: true });

  const create = async ({ amount, transactionType }: { amount: number; transactionType: TRANSACTION_TYPES }) => {
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount, transactionType, payeeId: payee.id }),
      raw: true,
    });
    return tx;
  };
  const netFlow = async () => [
    (await helpers.getPayeeById({ id: payee.id, raw: true })).stats?.netFlowRef,
    (await helpers.listPayees({ raw: true })).find((row) => row.id === payee.id)?.stats?.netFlowRef,
  ];

  await create({ amount: 10, transactionType: TRANSACTION_TYPES.expense });

  return { create, netFlow };
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

    // 0 initial - 50 - 200 (flagged) + 100
    const refreshed = await helpers.getAccount({ id: account.id, raw: true });
    expect(refreshed.currentBalance).toBe(-150);
  }, 60_000);

  it('drops the refund with its excluded original', async () => {
    const { create, netFlow } = await seedRefundGroup();
    const expense = await create({ amount: 200, transactionType: TRANSACTION_TYPES.expense });
    const refund = await create({ amount: 50, transactionType: TRANSACTION_TYPES.income });
    await linkRefund({ originalTxId: expense.id, refundTxId: refund.id });

    expect(await netFlow()).toEqual([-160, -160]);

    await flagTx({ id: expense.id });

    expect(await netFlow()).toEqual([-10, -10]);
  }, 60_000);

  it('drops the original with its excluded refund', async () => {
    const { create, netFlow } = await seedRefundGroup();
    const expense = await create({ amount: 200, transactionType: TRANSACTION_TYPES.expense });
    const refund = await create({ amount: 50, transactionType: TRANSACTION_TYPES.income });
    await linkRefund({ originalTxId: expense.id, refundTxId: refund.id });

    await flagTx({ id: refund.id });

    expect(await netFlow()).toEqual([-10, -10]);
  }, 60_000);

  it('drops the whole refund group when one of two partial refunds is excluded', async () => {
    const { create, netFlow } = await seedRefundGroup();
    const expense = await create({ amount: 200, transactionType: TRANSACTION_TYPES.expense });
    const flaggedRefund = await create({ amount: 50, transactionType: TRANSACTION_TYPES.income });
    const keptRefund = await create({ amount: 30, transactionType: TRANSACTION_TYPES.income });
    await linkRefund({ originalTxId: expense.id, refundTxId: flaggedRefund.id });
    await linkRefund({ originalTxId: expense.id, refundTxId: keptRefund.id });

    expect(await netFlow()).toEqual([-130, -130]);

    await flagTx({ id: flaggedRefund.id });

    expect(await netFlow()).toEqual([-10, -10]);
  }, 60_000);

  it('a trashed flagged original no longer hides its live refund', async () => {
    const { create, netFlow } = await seedRefundGroup();
    const expense = await create({ amount: 200, transactionType: TRANSACTION_TYPES.expense });
    const refund = await create({ amount: 50, transactionType: TRANSACTION_TYPES.income });
    await linkRefund({ originalTxId: expense.id, refundTxId: refund.id });
    await flagTx({ id: expense.id });

    expect(await netFlow()).toEqual([-10, -10]);

    expect((await helpers.deleteTransaction({ id: expense.id })).statusCode).toBe(200);

    expect(await netFlow()).toEqual([40, 40]);
  }, 60_000);

  it('keeps the flagged row out of the payee stats', async () => {
    const account = await helpers.createAccount({ raw: true });
    const payee = await helpers.createPayee({
      payload: helpers.buildPayeePayload({ name: 'Excluded payee' }),
      raw: true,
    });
    const create = async ({ amount }: { amount: number }) => {
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount,
          payeeId: payee.id,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      return tx;
    };

    await create({ amount: 100 });
    const flagged = await create({ amount: 40 });
    await helpers.updateTransaction({ id: flagged.id, payload: { excludeFromStats: true } });

    const detail = await helpers.getPayeeById({ id: payee.id, raw: true });
    const listed = (await helpers.listPayees({ raw: true })).find((row) => row.id === payee.id);

    for (const stats of [detail.stats, listed?.stats]) {
      expect(stats).toMatchObject({ transactionCount: 1, netFlowRef: -100 });
    }
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
    expect(before?.summary.actualExpense).toBe(100);
    expect((await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true })).biggestDay?.expense).toBe(100);

    await helpers.updateTransaction({ id: expense.id, payload: { excludeFromStats: true } });

    const after = await helpers.getTrackerStats({ id: tracker.id, raw: true });
    expect(after?.summary.actualExpense).toBe(0);
    expect((await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true })).biggestDay).toBeNull();
  }, 60_000);

  it('keeps the flagged row and its refund group out of the exported tracker spent total', async () => {
    const account = await helpers.createAccount({ raw: true });
    const create = async ({
      amount,
      transactionType,
      excludeFromStats,
    }: {
      amount: number;
      transactionType: TRANSACTION_TYPES;
      excludeFromStats?: boolean;
    }) => {
      const [tx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: account.id, amount, transactionType }),
          ...(excludeFromStats === undefined ? {} : { excludeFromStats }),
        },
        raw: true,
      });
      return tx;
    };

    const kept = await create({ amount: 100, transactionType: TRANSACTION_TYPES.expense });
    const flagged = await create({ amount: 200, transactionType: TRANSACTION_TYPES.expense, excludeFromStats: true });
    const refund = await create({ amount: 50, transactionType: TRANSACTION_TYPES.income });
    await helpers.createSingleRefund({ originalTxId: flagged.id, refundTxId: refund.id });

    const tracker = await helpers.createTracker({ name: 'Exported', raw: true });
    await helpers.addTransactionsToTracker({
      id: tracker.id,
      payload: { transactionIds: [kept.id, flagged.id, refund.id] },
    });

    const response = await helpers.exportData({ format: 'json', groups: ['budgets'] });
    const json = helpers.parseExportArchive({ buffer: response.body }).json as Record<
      string,
      Record<string, unknown>[]
    >;

    expect(json.trackers!.find((row) => row.name === 'Exported')!.spentAmount).toBe(100);
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
