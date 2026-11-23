import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import type { RecordId } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

type Period = { id: string; startDate: string; endDate: string };

const at = ({ period, offsetMinutes = 720 }: { period: Period; offsetMinutes?: number }) =>
  new Date(Date.parse(`${period.startDate}T00:00:00.000Z`) + offsetMinutes * 60_000).toISOString();

const setup = async () => {
  const account = await helpers.createAccount({ raw: true });
  const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
  const [groceries, transport] = await Promise.all([
    helpers.addCustomCategory({ name: 'Groceries', color: '#222222', parentId: food.id, raw: true }),
    helpers.addCustomCategory({ name: 'Transport', color: '#333333', raw: true }),
  ]);

  const { plan } = await helpers.createBudgetPlan({
    payload: { accountIds: [account.id], epochDate: helpers.budgetPeriodStart({ monthsAgo: 2 }) },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  const line = await helpers.createBudgetPlanLine({
    planId: plan.id,
    payload: { name: 'Food', categoryIds: [food.id], activeFrom: periods[0]!.startDate },
    raw: true,
  });

  return { account, food, groceries, transport, planId: plan.id, periods, period: periods[0]!, line };
};

const expense = async ({
  accountId,
  categoryId,
  amount,
  time,
  splits,
  transactionType = TRANSACTION_TYPES.expense,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  time: string;
  splits?: { categoryId: RecordId; amount: number }[];
  transactionType?: TRANSACTION_TYPES;
}) => {
  const [tx] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId,
        categoryId,
        amount,
        transactionType,
        ...(splits ? { splits } : {}),
      }),
      time,
    },
    raw: true,
  });
  return tx;
};

describe('GET /budget-plans/:planId/periods/:periodId/lines/:lineId/transactions', () => {
  it('returns the newest transactions up to the limit, with the total count', async () => {
    const { planId, period, line, food, account } = await setup();
    const oldest = await expense({ accountId: account.id, categoryId: food.id, amount: 10, time: at({ period }) });
    const middle = await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 20,
      time: at({ period, offsetMinutes: 1440 }),
    });
    const newest = await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 30,
      time: at({ period, offsetMinutes: 2880 }),
    });

    const page = await helpers.getBudgetLineTransactions({
      planId,
      periodId: period.id,
      lineId: line.id,
      limit: 2,
      raw: true,
    });
    expect(page.total).toBe(3);
    expect(page.transactions.map((tx) => tx.id)).toEqual([newest.id, middle.id]);

    const all = await helpers.getBudgetLineTransactions({ planId, periodId: period.id, lineId: line.id, raw: true });
    expect(all.transactions.map((tx) => tx.id)).toEqual([newest.id, middle.id, oldest.id]);
    expect(all.transactions[0]!.amount).toBe(30);
  });

  it('returns nothing for a line without activity in the period', async () => {
    const { planId, period, line } = await setup();

    const result = await helpers.getBudgetLineTransactions({ planId, periodId: period.id, lineId: line.id, raw: true });

    expect(result).toEqual({ total: 0, transactions: [] });
  });

  it('404s on an unknown line, period or plan', async () => {
    const { planId, period, line } = await setup();

    const unknownLine = await helpers.getBudgetLineTransactions({
      planId,
      periodId: period.id,
      lineId: generateRandomRecordId(),
    });
    expect(unknownLine.statusCode).toBe(ERROR_CODES.NotFoundError);

    const unknownPeriod = await helpers.getBudgetLineTransactions({
      planId,
      periodId: generateRandomRecordId(),
      lineId: line.id,
    });
    expect(unknownPeriod.statusCode).toBe(ERROR_CODES.NotFoundError);

    const unknownPlan = await helpers.getBudgetLineTransactions({
      planId: generateRandomRecordId(),
      periodId: period.id,
      lineId: line.id,
    });
    expect(unknownPlan.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('returns exactly the rows the fold counts, reconciling with the line activity', async () => {
    const { planId, period, line, food, groceries, transport, account } = await setup();
    const [outside, second] = await Promise.all([
      helpers.createAccount({ payload: helpers.buildAccountPayload({ name: 'outside' }), raw: true }),
      helpers.createAccount({ payload: helpers.buildAccountPayload({ name: 'second' }), raw: true }),
    ]);
    await helpers.setBudgetPlanAccounts({ planId, accountIds: [account.id, second.id], raw: true });

    const subcategory = await expense({
      accountId: account.id,
      categoryId: groceries.id,
      amount: 100,
      time: at({ period }),
    });
    await expense({ accountId: outside.id, categoryId: food.id, amount: 50, time: at({ period }) });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 70,
          categoryId: food.id,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 70,
          destinationAccountId: second.id,
        }),
        time: at({ period }),
      },
      raw: true,
    });
    const split = await expense({
      accountId: account.id,
      categoryId: transport.id,
      amount: 80,
      time: at({ period, offsetMinutes: 1440 }),
      splits: [{ categoryId: groceries.id, amount: 30 }],
    });
    await expense({ accountId: account.id, categoryId: transport.id, amount: 20, time: at({ period }) });

    const [result, view] = await Promise.all([
      helpers.getBudgetLineTransactions({ planId, periodId: period.id, lineId: line.id, raw: true }),
      helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true }),
    ]);

    expect(result.total).toBe(2);
    expect(result.transactions.map((tx) => tx.id)).toEqual([split.id, subcategory.id]);
    expect(view.lines.find((entry) => entry.lineId === line.id)!.activity).toBe(-(100 + 30));
  });

  it('ignores transactions of other periods', async () => {
    const { planId, periods, line, food, account } = await setup();
    const first = await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 10,
      time: at({ period: periods[0]! }),
    });
    const second = await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 20,
      time: at({ period: periods[1]! }),
    });

    const [inFirst, inSecond] = await Promise.all(
      [periods[0]!, periods[1]!].map((period) =>
        helpers.getBudgetLineTransactions({ planId, periodId: period.id, lineId: line.id, raw: true }),
      ),
    );

    expect(inFirst!.total).toBe(1);
    expect(inFirst!.transactions.map((tx) => tx.id)).toEqual([first.id]);
    expect(inSecond!.total).toBe(1);
    expect(inSecond!.transactions.map((tx) => tx.id)).toEqual([second.id]);
  });

  it('lists an expense and its full refund separately while the line activity nets to zero', async () => {
    const { planId, period, line, food, transport, account } = await setup();
    const original = await expense({ accountId: account.id, categoryId: food.id, amount: 100, time: at({ period }) });
    const refund = await expense({
      accountId: account.id,
      categoryId: transport.id,
      amount: 100,
      time: at({ period, offsetMinutes: 1440 }),
      transactionType: TRANSACTION_TYPES.income,
    });
    await helpers.createSingleRefund({ originalTxId: original.id, refundTxId: refund.id }, true);

    const [result, view] = await Promise.all([
      helpers.getBudgetLineTransactions({ planId, periodId: period.id, lineId: line.id, raw: true }),
      helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true }),
    ]);

    expect(result.total).toBe(2);
    expect(result.transactions.map((tx) => tx.id)).toEqual([refund.id, original.id]);
    expect(view.lines.find((entry) => entry.lineId === line.id)!.activity).toBe(0);
  });

  it('rejects a limit outside 1..50 or not a number', async () => {
    const { planId, period, line } = await setup();

    for (const limit of [0, 51, 'abc']) {
      const response = await helpers.getBudgetLineTransactions({ planId, periodId: period.id, lineId: line.id, limit });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }
  });

  it('returns 5 transactions by default', async () => {
    const { planId, period, line, food, account } = await setup();
    for (let index = 0; index < 6; index++) {
      await expense({
        accountId: account.id,
        categoryId: food.id,
        amount: 10 + index,
        time: at({ period, offsetMinutes: 60 * index }),
      });
    }

    const result = await helpers.getBudgetLineTransactions({ planId, periodId: period.id, lineId: line.id, raw: true });

    expect(result.total).toBe(6);
    expect(result.transactions).toHaveLength(5);
  });

  it('lists a split once when all its parts land on the line', async () => {
    const { planId, period, line, food, groceries, account } = await setup();
    const split = await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 80,
      time: at({ period }),
      splits: [{ categoryId: groceries.id, amount: 30 }],
    });

    const [result, view] = await Promise.all([
      helpers.getBudgetLineTransactions({ planId, periodId: period.id, lineId: line.id, raw: true }),
      helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true }),
    ]);

    expect(result.total).toBe(1);
    expect(result.transactions.map((tx) => tx.id)).toEqual([split.id]);
    expect(view.lines.find((entry) => entry.lineId === line.id)!.activity).toBe(-80);
  });
});
