import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import type { Decimal, RecordId } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';

type Period = { id: string; startDate: string; endDate: string };

/** An explicit UTC instant inside (or, with a negative offset, just before) a period. */
const at = ({ period, offsetMinutes = 720 }: { period: Period; offsetMinutes?: number }) =>
  new Date(Date.parse(`${period.startDate}T00:00:00.000Z`) + offsetMinutes * 60_000).toISOString();

const setup = async ({ monthsAgo = 2 }: { monthsAgo?: number } = {}) => {
  const account = await helpers.createAccount({ raw: true });
  const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
  const [groceries, transport] = await Promise.all([
    helpers.addCustomCategory({ name: 'Groceries', color: '#222222', parentId: food.id, raw: true }),
    helpers.addCustomCategory({ name: 'Transport', color: '#333333', raw: true }),
  ]);

  const { plan } = await helpers.createBudgetPlan({
    payload: { accountIds: [account.id], epochDate: helpers.budgetPeriodStart({ monthsAgo }) },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  const line = await helpers.createBudgetPlanLine({
    planId: plan.id,
    payload: { name: 'Food', categoryIds: [food.id], activeFrom: periods[0]!.startDate },
    raw: true,
  });

  return { account, food, groceries, transport, planId: plan.id, periods, line };
};

const view = ({ planId, period }: { planId: string; period: Period }) =>
  helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true });

interface TxParams {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  time: string;
  splits?: { categoryId: RecordId; amount: number }[];
}

const tx = ({ transactionType, splits, time, ...rest }: TxParams & { transactionType: TRANSACTION_TYPES }) =>
  helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ ...rest, transactionType, ...(splits ? { splits } : {}) }),
      time,
    },
    raw: true,
  });

const expense = (params: TxParams) => tx({ ...params, transactionType: TRANSACTION_TYPES.expense });
const income = (params: TxParams) => tx({ ...params, transactionType: TRANSACTION_TYPES.income });

describe('Budget plan period view: activity attribution', () => {
  it('lands an expense in a child category on the parent line', async () => {
    const { planId, periods, groceries, account } = await setup();
    await expense({
      accountId: account.id,
      categoryId: groceries.id,
      amount: 100,
      time: at({ period: periods[0]! }),
    });

    const result = await view({ planId, period: periods[0]! });

    expect(result.lines[0]!.activity).toBe(-100);
    expect(result.unbudgeted).toEqual([]);
  });

  it('splits a partial split between the parent category and the split category', async () => {
    const { planId, periods, food, transport, account } = await setup();
    await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Transport', categoryIds: [transport.id], sortOrder: 1, activeFrom: periods[0]!.startDate },
      raw: true,
    });

    await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 100,
      time: at({ period: periods[0]! }),
      splits: [{ categoryId: transport.id, amount: 30 }],
    });

    const result = await view({ planId, period: periods[0]! });

    expect(result.lines.map((line) => [line.name, line.activity])).toEqual([
      ['Food', -70],
      ['Transport', -30],
    ]);
  });

  it('nets income in a line category against its spending', async () => {
    const { planId, periods, food, account } = await setup();
    await expense({ accountId: account.id, categoryId: food.id, amount: 100, time: at({ period: periods[0]! }) });
    await income({ accountId: account.id, categoryId: food.id, amount: 40, time: at({ period: periods[0]! }) });

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(-60);
  });

  it('puts a transaction in the period its UTC instant falls into, not the neighbour', async () => {
    const { planId, periods, food, account } = await setup();

    await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 10,
      time: at({ period: periods[1]!, offsetMinutes: -30 }),
    });
    await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 20,
      time: at({ period: periods[1]!, offsetMinutes: 30 }),
    });

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(-10);
    expect((await view({ planId, period: periods[1]! })).lines[0]!.activity).toBe(-20);
  });

  it('returns uncovered negative spending as unbudgeted, rolled up to the root category', async () => {
    const { planId, periods, transport, account } = await setup();
    const fun = await helpers.addCustomCategory({ name: 'Fun', color: '#444444', raw: true });
    const games = await helpers.addCustomCategory({ name: 'Games', color: '#555555', parentId: fun.id, raw: true });

    await expense({ accountId: account.id, categoryId: transport.id, amount: 15, time: at({ period: periods[0]! }) });
    await expense({ accountId: account.id, categoryId: games.id, amount: 25, time: at({ period: periods[0]! }) });

    const result = await view({ planId, period: periods[0]! });

    expect(result.lines[0]!.activity).toBe(0);
    expect(result.unbudgeted.toSorted((a, b) => a.activity - b.activity)).toEqual([
      { categoryId: fun.id, activity: -25 },
      { categoryId: transport.id, activity: -15 },
    ]);
  });

  it('sums the header over several lines', async () => {
    const { planId, periods, food, transport, account, line } = await setup();
    const transportLine = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Transport', categoryIds: [transport.id], activeFrom: periods[0]!.startDate },
      raw: true,
    });

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 12.34 },
      raw: true,
    });
    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: transportLine.id,
      payload: { scope: 'from_here', amount: 50 },
      raw: true,
    });

    await expense({ accountId: account.id, categoryId: food.id, amount: 0.29, time: at({ period: periods[0]! }) });
    await expense({ accountId: account.id, categoryId: transport.id, amount: 30, time: at({ period: periods[0]! }) });

    const result = await view({ planId, period: periods[0]! });

    expect(result.lines.find((entry) => entry.name === 'Food')).toMatchObject({
      assigned: 12.34,
      activity: -0.29,
      available: 12.05,
    });
    expect(result.header).toEqual({
      totalAssigned: 62.34,
      totalActivity: -30.29,
      totalAvailable: 32.05,
      totalCarriedIn: 0,
    });
  });
});

describe('Budget plan period view: scope rules', () => {
  it('ignores a transfer between plan accounts and counts the loan-payment expense leg', async () => {
    const second = await helpers.createAccount({ payload: helpers.buildAccountPayload({ name: 'second' }), raw: true });
    const { planId, periods, food, account } = await setup();
    await helpers.setBudgetPlanAccounts({ planId, accountIds: [account.id, second.id], raw: true });

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
        time: at({ period: periods[0]! }),
      },
      raw: true,
    });

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(0);

    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({
        currencyCode: global.BASE_CURRENCY.code,
        initialBalance: 2_500,
        originalPrincipal: 2_500,
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          categoryId: food.id,
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: loan.id as RecordId,
        }),
        time: at({ period: periods[0]! }),
      },
      raw: true,
    });

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(-500);
  });

  it('ignores a counted transaction that carries no category', async () => {
    const { planId, periods, transport, account } = await setup();
    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({
        currencyCode: global.BASE_CURRENCY.code,
        initialBalance: 2_500,
        originalPrincipal: 2_500,
      }),
      raw: true,
    });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          categoryId: undefined,
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: loan.id as RecordId,
        }),
        time: at({ period: periods[0]! }),
      },
      raw: true,
    });
    await expense({ accountId: account.id, categoryId: transport.id, amount: 15, time: at({ period: periods[0]! }) });

    expect((await helpers.getBudgetPlanPeriodView({ planId, periodId: periods[0]!.id })).statusCode).toBe(200);

    const result = await view({ planId, period: periods[0]! });
    expect(result.lines[0]!.activity).toBe(0);
    expect(result.unbudgeted).toEqual([{ categoryId: transport.id, activity: -15 }]);
  });

  it('excludes planned transactions and balance adjustments', async () => {
    const { planId, periods, food, account } = await setup();

    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 90,
        categoryId: food.id,
        transactionType: TRANSACTION_TYPES.expense,
        time: at({ period: periods[0]! }),
      },
      raw: true,
    });
    await helpers.balanceAdjustment({
      id: account.id,
      payload: { targetBalance: -300 as Decimal, time: at({ period: periods[0]! }) },
      raw: true,
    });

    const result = await view({ planId, period: periods[0]! });
    expect(result.lines[0]!.activity).toBe(0);
    expect(result.unbudgeted).toEqual([]);
  });

  it('excludes an excludeFromStats account and an account outside the plan', async () => {
    const { planId, periods, food, account } = await setup();
    const offPlan = await helpers.createAccount({ payload: helpers.buildAccountPayload({ name: 'off' }), raw: true });
    await helpers.setBudgetPlanAccounts({ planId, accountIds: [account.id], raw: true });

    await expense({ accountId: offPlan.id, categoryId: food.id, amount: 11, time: at({ period: periods[0]! }) });
    await expense({ accountId: account.id, categoryId: food.id, amount: 22, time: at({ period: periods[0]! }) });

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(-22);

    await helpers.updateAccount({ id: account.id, payload: { excludeFromStats: true }, raw: true });

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(0);
  });

  it('converts a foreign-currency expense through refAmount', async () => {
    const { account, currency } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });
    await helpers.editUserCurrencyExchangeRate({
      pairs: [
        { baseCode: currency.code, quoteCode: global.BASE_CURRENCY!.code, rate: 0.1 },
        { baseCode: global.BASE_CURRENCY!.code, quoteCode: currency.code, rate: 10 },
      ],
    });

    const { planId, periods, food } = await setup();
    await helpers.setBudgetPlanAccounts({ planId, accountIds: [account.id], raw: true });

    await expense({ accountId: account.id, categoryId: food.id, amount: 1000, time: at({ period: periods[0]! }) });

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(-100);
  });
});

describe('Budget plan period view: refunds', () => {
  it('leaves the original period untouched and credits the original category in the refund period', async () => {
    const { planId, periods, food, transport, account } = await setup();

    const [original] = await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 1000,
      time: at({ period: periods[0]! }),
    });
    const [refund] = await income({
      accountId: account.id,
      categoryId: transport.id,
      amount: 400,
      time: at({ period: periods[2]! }),
    });
    await helpers.createSingleRefund({ originalTxId: original.id, refundTxId: refund.id }, true);

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(-1000);
    expect((await view({ planId, period: periods[2]! })).lines[0]!.activity).toBe(400);
    expect((await view({ planId, period: periods[2]! })).unbudgeted).toEqual([]);
  });

  it('credits the original split category when the refund targets a split', async () => {
    const { planId, periods, food, transport, account } = await setup();

    const [original] = await expense({
      accountId: account.id,
      categoryId: transport.id,
      amount: 100,
      time: at({ period: periods[0]! }),
      splits: [{ categoryId: food.id, amount: 30 }],
    });
    const transactions = await helpers.getTransactions({ raw: true, includeSplits: true });
    const split = transactions!.find((transaction) => transaction.id === original.id)!.splits![0]!;

    const [refund] = await income({
      accountId: account.id,
      categoryId: transport.id,
      amount: 30,
      time: at({ period: periods[1]! }),
    });
    await helpers.createSingleRefund({ originalTxId: original.id, refundTxId: refund.id, splitId: split.id }, true);

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(-30);
    expect((await view({ planId, period: periods[1]! })).lines[0]!.activity).toBe(30);
  });

  it('keeps its own category when the original is pre-epoch, off-plan, or missing', async () => {
    const { planId, periods, food, transport, account } = await setup();
    const offPlan = await helpers.createAccount({ payload: helpers.buildAccountPayload({ name: 'off' }), raw: true });
    await helpers.setBudgetPlanAccounts({ planId, accountIds: [account.id], raw: true });
    await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Transport', categoryIds: [transport.id], sortOrder: 1, activeFrom: periods[0]!.startDate },
      raw: true,
    });

    const [preEpoch] = await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 500,
      time: at({ period: periods[0]!, offsetMinutes: -1440 }),
    });
    const [offPlanOriginal] = await expense({
      accountId: offPlan.id,
      categoryId: food.id,
      amount: 500,
      time: at({ period: periods[0]! }),
    });

    const [refundA] = await income({
      accountId: account.id,
      categoryId: transport.id,
      amount: 10,
      time: at({ period: periods[1]! }),
    });
    const [refundB] = await income({
      accountId: account.id,
      categoryId: transport.id,
      amount: 20,
      time: at({ period: periods[1]! }),
    });
    const [refundC] = await income({
      accountId: account.id,
      categoryId: transport.id,
      amount: 30,
      time: at({ period: periods[1]! }),
    });

    await helpers.createSingleRefund({ originalTxId: preEpoch.id, refundTxId: refundA.id }, true);
    await helpers.createSingleRefund({ originalTxId: offPlanOriginal.id, refundTxId: refundB.id }, true);
    await helpers.createSingleRefund({ originalTxId: null, refundTxId: refundC.id }, true);

    const result = await view({ planId, period: periods[1]! });

    // The Food line, which holds both originals' category, stays untouched:
    // the refunds count as income on the category they carry themselves.
    expect(result.lines.map((line) => [line.name, line.activity])).toEqual([
      ['Food', 0],
      ['Transport', 60],
    ]);
    expect(result.unbudgeted).toEqual([]);
  });

  it('drops a refund whose counted original carries no category', async () => {
    const { planId, periods, food, account } = await setup();

    const [original] = await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 100,
      time: at({ period: periods[0]! }),
    });
    const [refund] = await income({
      accountId: account.id,
      categoryId: food.id,
      amount: 40,
      time: at({ period: periods[1]! }),
    });
    await helpers.createSingleRefund({ originalTxId: original.id, refundTxId: refund.id }, true);

    // The create endpoint rejects an uncategorised non-transfer expense; imports produce them.
    await Transactions.update({ categoryId: null }, { where: { id: original.id } });

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(0);
    expect((await view({ planId, period: periods[1]! })).lines[0]!.activity).toBe(0);
  });

  it('does not count a refund paid into an account outside the plan', async () => {
    const { planId, periods, food, account } = await setup();
    const offPlan = await helpers.createAccount({ payload: helpers.buildAccountPayload({ name: 'off' }), raw: true });
    await helpers.setBudgetPlanAccounts({ planId, accountIds: [account.id], raw: true });

    const [original] = await expense({
      accountId: account.id,
      categoryId: food.id,
      amount: 100,
      time: at({ period: periods[0]! }),
    });
    const [refund] = await income({
      accountId: offPlan.id,
      categoryId: food.id,
      amount: 40,
      time: at({ period: periods[0]! }),
    });
    await helpers.createSingleRefund({ originalTxId: original.id, refundTxId: refund.id }, true);

    expect((await view({ planId, period: periods[0]! })).lines[0]!.activity).toBe(-100);
  });
});

describe('Budget plan period view: line edits', () => {
  it('leaves a backdated period unchanged when a line swaps categories now', async () => {
    const { planId, periods, food, transport, account, line } = await setup();

    await expense({ accountId: account.id, categoryId: food.id, amount: 40, time: at({ period: periods[0]! }) });
    await expense({ accountId: account.id, categoryId: food.id, amount: 60, time: at({ period: periods[2]! }) });

    await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [transport.id] },
      raw: true,
    });

    const backdated = await view({ planId, period: periods[0]! });
    expect(backdated.lines[0]).toMatchObject({ categoryIds: [food.id], activity: -40 });
    expect(backdated.unbudgeted).toEqual([]);

    const current = await view({ planId, period: periods[2]! });
    expect(current.lines[0]).toMatchObject({ categoryIds: [transport.id], activity: 0 });
    expect(current.unbudgeted).toEqual([{ categoryId: food.id, activity: -60 }]);
  });

  it('404s on an unknown period and on an unknown plan', async () => {
    const { planId } = await setup();

    expect((await helpers.getBudgetPlanPeriodView({ planId, periodId: generateRandomRecordId() })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
    expect(
      (
        await helpers.getBudgetPlanPeriodView({
          planId: generateRandomRecordId(),
          periodId: generateRandomRecordId(),
        })
      ).statusCode,
    ).toBe(ERROR_CODES.NotFoundError);
  });

  it('returns an empty view for a plan with no lines', async () => {
    const { plan } = await helpers.createBudgetPlan({ raw: true });
    const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });

    expect(await helpers.getBudgetPlanPeriodView({ planId: plan.id, periodId: periods[0]!.id, raw: true })).toEqual({
      period: { ...periods[0]!, isCurrent: true },
      header: { totalAssigned: 0, totalActivity: 0, totalAvailable: 0, totalCarriedIn: 0 },
      lines: [],
      groups: [],
      unbudgeted: [],
      pool: null,
      goals: null,
      coverage: null,
    });
  });
});
