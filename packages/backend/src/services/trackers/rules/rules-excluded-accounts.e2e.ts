import { TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

/** Rules skip `excludeFromStats` accounts; hand-linked rows count regardless of account. */
describe('Tracker rules skip accounts marked excludeFromStats', () => {
  const INCLUDED_TX_TIME = '2025-03-10T10:00:00Z';

  it('excludes excludeFromStats accounts from stats, spending breakdown and transaction list', async () => {
    const category = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });

    const includedAccount = await helpers.createAccount({ raw: true });
    const excludedAccount = await helpers.createAccount({ raw: true });
    await helpers.updateAccount({ id: excludedAccount.id, payload: { excludeFromStats: true }, raw: true });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: includedAccount.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: category.id,
        time: INCLUDED_TX_TIME,
      }),
      raw: true,
    });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: excludedAccount.id,
        amount: 400,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: category.id,
        time: '2025-03-11T10:00:00Z',
      }),
      raw: true,
    });

    const tracker = await helpers.createTracker({
      name: 'Groceries Tracker',
      rulesEnabled: true,
      categoryIds: [category.id],
      startDate: '2025-03-01T00:00:00Z',
      endDate: '2025-03-31T23:59:59Z',
      limitAmount: 500,
      raw: true,
    });

    const stats = (await helpers.getTrackerStats({ id: tracker.id, raw: true }))!;

    expect(stats.summary.actualExpense).toBe(100);
    expect(stats.summary.actualIncome).toBe(0);
    expect(stats.summary.balance).toBe(-100);
    expect(stats.summary.transactionsCount).toBe(1);
    expect(stats.summary.utilizationRate).toBeCloseTo((100 / 500) * 100, 1);
    expect(new Date(stats.summary.lastTransactionDate!).toISOString()).toBe(new Date(INCLUDED_TX_TIME).toISOString());

    const spending = await helpers.getTrackerSpendingStats({
      id: tracker.id,
      raw: true,
    });

    expect(spending.spendingsByCategory).toHaveLength(1);
    expect(spending.spendingsByCategory[0]!.categoryId).toBe(category.id);
    expect(spending.spendingsByCategory[0]!.amount).toBe(100);
    expect(spending.spendingOverTime.periods.reduce((sum, period) => sum + period.expense, 0)).toBe(100);

    const linked = await helpers.getTransactions({ trackerIds: [tracker.id], raw: true });
    expect(linked.map((tx) => tx.accountId)).toEqual([includedAccount.id]);
  }, 60_000);
});

describe('Hand-linked rows from accounts marked excludeFromStats', () => {
  const EXCLUDED_TX_TIME = '2025-03-11T10:00:00Z';

  it('count in tracker stats and spending breakdown', async () => {
    const category = await helpers.addCustomCategory({ name: 'Groceries', color: '#FF0000', raw: true });

    const includedAccount = await helpers.createAccount({ raw: true });
    const excludedAccount = await helpers.createAccount({ raw: true });
    await helpers.updateAccount({ id: excludedAccount.id, payload: { excludeFromStats: true }, raw: true });

    const [includedTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: includedAccount.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: category.id,
        time: '2025-03-10T10:00:00Z',
      }),
      raw: true,
    });

    const [excludedTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: excludedAccount.id,
        amount: 400,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: category.id,
        time: EXCLUDED_TX_TIME,
      }),
      raw: true,
    });

    const tracker = await helpers.createTracker({
      name: 'Manual Groceries Tracker',
      startDate: '2025-03-01T00:00:00Z',
      endDate: '2025-03-31T23:59:59Z',
      limitAmount: 500,
      raw: true,
    });

    await helpers.addTransactionsToTracker({
      id: tracker.id,
      payload: { transactionIds: [includedTx!.id, excludedTx!.id] },
      raw: true,
    });

    const stats = (await helpers.getTrackerStats({ id: tracker.id, raw: true }))!;

    expect(stats.summary.actualExpense).toBe(500);
    expect(stats.summary.actualIncome).toBe(0);
    expect(stats.summary.balance).toBe(-500);
    expect(stats.summary.transactionsCount).toBe(2);
    expect(stats.summary.utilizationRate).toBeCloseTo((500 / 500) * 100, 1);
    expect(new Date(stats.summary.lastTransactionDate!).toISOString()).toBe(new Date(EXCLUDED_TX_TIME).toISOString());

    const spending = await helpers.getTrackerSpendingStats({
      id: tracker.id,
      raw: true,
    });

    expect(spending.spendingsByCategory).toHaveLength(1);
    expect(spending.spendingsByCategory[0]!.categoryId).toBe(category.id);
    expect(spending.spendingsByCategory[0]!.amount).toBe(500);
    expect(spending.spendingOverTime.periods.reduce((sum, period) => sum + period.expense, 0)).toBe(500);

    const linked = await helpers.getTransactions({ trackerIds: [tracker.id], raw: true });
    expect(linked.map((item) => item.id).toSorted()).toEqual([includedTx!.id, excludedTx!.id].toSorted());
  }, 60_000);
});
