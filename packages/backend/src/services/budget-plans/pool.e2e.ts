import { ACCOUNT_CATEGORIES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import type { BudgetPlanCarryPolicy, BudgetPlanPool, RecordId } from '@bt/shared/types';
import { afterEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { startOfDay, subDays } from 'date-fns';

type Period = { id: string; startDate: string; endDate: string };

const at = ({ period, offsetMinutes = 720 }: { period: Period; offsetMinutes?: number }) =>
  new Date(Date.parse(`${period.startDate}T00:00:00.000Z`) + offsetMinutes * 60_000).toISOString();

const setup = async ({
  carryPolicy = 'floor',
  initialBalance = 1000,
  poolEnabled = true,
  monthsAgo = 2,
}: {
  carryPolicy?: BudgetPlanCarryPolicy;
  initialBalance?: number;
  poolEnabled?: boolean;
  monthsAgo?: number;
} = {}) => {
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ initialBalance }),
    raw: true,
  });
  const [food, salary, fun] = await Promise.all([
    helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true }),
    helpers.addCustomCategory({ name: 'Salary', color: '#222222', raw: true }),
    helpers.addCustomCategory({ name: 'Fun', color: '#333333', raw: true }),
  ]);

  const { plan } = await helpers.createBudgetPlan({
    payload: {
      accountIds: [account.id],
      epochDate: helpers.budgetPeriodStart({ monthsAgo }),
      carryPolicy,
      poolEnabled,
    },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({
    planId: plan.id,
    raw: true,
  });
  const line = await helpers.createBudgetPlanLine({
    planId: plan.id,
    payload: {
      name: 'Food',
      categoryIds: [food.id],
      activeFrom: periods[0]!.startDate,
    },
    raw: true,
  });

  return { account, food, salary, fun, plan, planId: plan.id, periods, line };
};

const pool = async ({ planId, period }: { planId: string; period: Period }): Promise<BudgetPlanPool> => {
  const result = await helpers.getBudgetPlanPeriodView({
    planId,
    periodId: period.id,
    raw: true,
  });
  const value = result.pool!;
  const { leftOver, income, outsideSpending, fromLines, assigned } = value.flow;
  expect(leftOver + income + outsideSpending + fromLines - assigned).toBeCloseTo(
    value.readyToAssign + value.committedLater,
    2,
  );
  return value;
};

const tx = ({
  accountId,
  categoryId,
  amount,
  time,
  transactionType,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  time: string;
  transactionType: TRANSACTION_TYPES;
}) =>
  helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId,
        categoryId,
        amount,
        transactionType,
      }),
      time,
    },
    raw: true,
  });

const assign = ({
  planId,
  period,
  lineId,
  amount,
}: {
  planId: string;
  period: Period;
  lineId: string;
  amount: number;
}) =>
  helpers.setBudgetAssignment({
    planId,
    periodId: period.id,
    lineId,
    payload: { scope: 'this_period', amount },
    raw: true,
  });

describe('Budget plan pool: switch', () => {
  it('returns pool: null and poolFrom: null when the pool is off', async () => {
    const { plan, planId, periods } = await setup({ poolEnabled: false });

    expect(plan.poolFrom).toBeNull();
    const result = await helpers.getBudgetPlanPeriodView({
      planId,
      periodId: periods[2]!.id,
      raw: true,
    });
    expect(result.pool).toBeNull();
    expect(result.header.totalCarriedIn).toBe(0);
  });

  it('starts the pool at the epoch when created with poolEnabled', async () => {
    const { plan, periods } = await setup();

    expect(plan.poolFrom).toBe(periods[0]!.startDate);
  });

  it('opens with the attached cash before poolFrom and keeps it through later periods', async () => {
    const { planId, periods } = await setup();

    expect(await pool({ planId, period: periods[0]! })).toEqual({
      readyToAssign: 1000,
      committedLater: 0,
      flow: {
        leftOver: 1000,
        income: 0,
        outsideSpending: 0,
        fromLines: 0,
        assigned: 0,
      },
      balance: { cash: 1000, inLines: 0, drift: 0 },
    });
    expect((await pool({ planId, period: periods[2]! })).readyToAssign).toBe(1000);
  });

  it('rejects a bad poolEnabled on create and update, and a raw poolFrom on update', async () => {
    const account = await helpers.createAccount({ raw: true });
    const created = await helpers.createBudgetPlan({
      payload: {
        accountIds: [account.id],
        poolEnabled: 'yes' as unknown as boolean,
      },
    });
    expect(created.statusCode).toBe(ERROR_CODES.ValidationError);

    const { planId, periods } = await setup({ poolEnabled: false });
    expect(
      (
        await helpers.updateBudgetPlan({
          planId,
          payload: { poolEnabled: 'on' },
        })
      ).statusCode,
    ).toBe(ERROR_CODES.ValidationError);
    expect(
      (
        await helpers.updateBudgetPlan({
          planId,
          payload: { poolFrom: periods[0]!.startDate },
        })
      ).statusCode,
    ).toBe(ERROR_CODES.ValidationError);
  });
});

describe('Budget plan pool: zero-sum', () => {
  it('turns zero-sum on for a pool plan and off with the pool', async () => {
    const { plan, planId } = await setup();
    expect(plan.zeroSum).toBe(false);

    const enabled = await helpers.updateBudgetPlan({
      planId,
      payload: { zeroSum: true },
      raw: true,
    });
    expect(enabled.plan.zeroSum).toBe(true);

    const renamed = await helpers.updateBudgetPlan({
      planId,
      payload: { name: 'Renamed', carryPolicy: 'floor' },
      raw: true,
    });
    expect(renamed.plan.zeroSum).toBe(true);

    const poolOff = await helpers.updateBudgetPlan({
      planId,
      payload: { poolEnabled: false },
      raw: true,
    });
    expect(poolOff.plan.poolFrom).toBeNull();
    expect(poolOff.plan.zeroSum).toBe(false);
  });

  it('rejects zero-sum on a plan without a pool, or one turned off in the same request', async () => {
    const { planId } = await setup({ poolEnabled: false });

    const withoutPool = await helpers.updateBudgetPlan({
      planId,
      payload: { zeroSum: true },
    });
    expect(withoutPool.statusCode).toBe(ERROR_CODES.ConflictError);

    const pooled = await helpers.updateBudgetPlan({
      planId,
      payload: { poolEnabled: true },
      raw: true,
    });
    const turningOff = await helpers.updateBudgetPlan({
      planId,
      payload: { poolEnabled: false, zeroSum: true },
    });
    expect(turningOff.statusCode).toBe(ERROR_CODES.ConflictError);

    const after = await helpers.getBudgetPlan({ planId, raw: true });
    expect(after.plan.poolFrom).toBe(pooled.plan.poolFrom);
    expect(after.plan.zeroSum).toBe(false);
  });

  it('turns the pool and zero-sum on in one request', async () => {
    const { planId, periods } = await setup({ poolEnabled: false });

    const updated = await helpers.updateBudgetPlan({
      planId,
      payload: { poolEnabled: true, zeroSum: true },
      raw: true,
    });
    expect(updated.plan.poolFrom).toBe(periods[2]!.startDate);
    expect(updated.plan.zeroSum).toBe(true);
  });

  it('rejects a bad zeroSum and still rejects unknown fields next to it', async () => {
    const { planId } = await setup();

    expect((await helpers.updateBudgetPlan({ planId, payload: { zeroSum: 'on' } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
    expect((await helpers.updateBudgetPlan({ planId, payload: { zeroSum: true, type: 'zero_sum' } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
  });
});

describe('Budget plan pool: flow', () => {
  it('does not count spending after poolFrom twice when bootstrapping mid-period', async () => {
    const { planId, periods, account, fun } = await setup({ monthsAgo: 0 });

    await tx({
      accountId: account.id,
      categoryId: fun.id,
      amount: 200,
      time: at({ period: periods[0]!, offsetMinutes: 1 }),
      transactionType: TRANSACTION_TYPES.expense,
    });

    expect(await pool({ planId, period: periods[0]! })).toEqual({
      readyToAssign: 800,
      committedLater: 0,
      flow: {
        leftOver: 1000,
        income: 0,
        outsideSpending: -200,
        fromLines: 0,
        assigned: 0,
      },
      balance: { cash: 800, inLines: 0, drift: 0 },
    });
  });

  it('raises the pool with income in an uncovered category and lowers it with spending outside lines', async () => {
    const { planId, periods, account, salary, fun } = await setup();

    await tx({
      accountId: account.id,
      categoryId: salary.id,
      amount: 500,
      time: at({ period: periods[0]! }),
      transactionType: TRANSACTION_TYPES.income,
    });
    await tx({
      accountId: account.id,
      categoryId: fun.id,
      amount: 120,
      time: at({ period: periods[0]! }),
      transactionType: TRANSACTION_TYPES.expense,
    });

    const first = await pool({ planId, period: periods[0]! });
    expect(first.flow).toEqual({
      leftOver: 1000,
      income: 500,
      outsideSpending: -120,
      fromLines: 0,
      assigned: 0,
    });
    expect(first.readyToAssign).toBe(1380);
    expect(first.balance).toEqual({ cash: 1380, inLines: 0, drift: 0 });

    expect((await pool({ planId, period: periods[1]! })).flow.leftOver).toBe(1380);
  });

  it('counts an uncategorised loan payment as spending outside lines', async () => {
    const { planId, periods, account } = await setup();
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
          amount: 300,
          categoryId: undefined,
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 300,
          destinationAccountId: loan.id as RecordId,
        }),
        time: at({ period: periods[0]! }),
      },
      raw: true,
    });

    const result = await pool({ planId, period: periods[0]! });
    expect(result.flow.outsideSpending).toBe(-300);
    expect(result.readyToAssign).toBe(700);
    expect(result.balance.drift).toBe(0);
  });

  it('lowers the pool by what is assigned and keeps it in lines', async () => {
    const { planId, periods, line } = await setup();

    await assign({ planId, period: periods[0]!, lineId: line.id, amount: 300 });

    expect(await pool({ planId, period: periods[0]! })).toEqual({
      readyToAssign: 700,
      committedLater: 0,
      flow: {
        leftOver: 1000,
        income: 0,
        outsideSpending: 0,
        fromLines: 0,
        assigned: 300,
      },
      balance: { cash: 1000, inLines: 300, drift: 0 },
    });

    const next = await helpers.getBudgetPlanPeriodView({
      planId,
      periodId: periods[1]!.id,
      raw: true,
    });
    expect(next.header.totalCarriedIn).toBe(300);
    expect(next.pool!.readyToAssign).toBe(700);
  });

  it('lowers the current readyToAssign by an assignment in a future period', async () => {
    const { planId, periods, line } = await setup();

    await assign({ planId, period: periods[3]!, lineId: line.id, amount: 200 });

    const current = await pool({ planId, period: periods[2]! });
    expect(current.readyToAssign).toBe(800);
    expect(current.committedLater).toBe(200);

    const past = await pool({ planId, period: periods[0]! });
    expect(past.readyToAssign).toBe(800);
    expect(past.committedLater).toBe(200);

    const future = await pool({ planId, period: periods[3]! });
    expect(future.readyToAssign).toBe(800);
    expect(future.committedLater).toBe(0);
    expect(future.flow.assigned).toBe(200);
  });

  it('commits an explicit future assignment but not a recurring baseline', async () => {
    const { planId, periods, line } = await setup();

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[2]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 100 },
      raw: true,
    });

    expect(await pool({ planId, period: periods[2]! })).toMatchObject({
      readyToAssign: 900,
      committedLater: 0,
    });

    await assign({ planId, period: periods[3]!, lineId: line.id, amount: 50 });

    expect(await pool({ planId, period: periods[2]! })).toMatchObject({
      readyToAssign: 850,
      committedLater: 50,
    });
    const later = await helpers.getBudgetPlanPeriodView({
      planId,
      periodId: periods[4]!.id,
      raw: true,
    });
    expect(later.lines[0]!.assigned).toBe(100);
  });

  it('counts a future from_here baseline as pool-assigned only in the period it is set in', async () => {
    const { planId, periods, line } = await setup();

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[3]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 100 },
      raw: true,
    });

    const lineIn = async ({ period }: { period: Period }) =>
      (await helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true })).lines[0]!;

    expect(await lineIn({ period: periods[3]! })).toMatchObject({
      assigned: 100,
      poolAssigned: 100,
      assignedSource: 'baseline',
    });
    expect(await lineIn({ period: periods[4]! })).toMatchObject({
      assigned: 100,
      poolAssigned: 0,
      assignedSource: 'baseline',
    });
  });

  it('deducts a floored overspend from the next period pool exactly once', async () => {
    const { planId, periods, line, account, food } = await setup({
      carryPolicy: 'floor',
    });

    await assign({ planId, period: periods[0]!, lineId: line.id, amount: 100 });
    await tx({
      accountId: account.id,
      categoryId: food.id,
      amount: 150,
      time: at({ period: periods[0]! }),
      transactionType: TRANSACTION_TYPES.expense,
    });

    const first = await pool({ planId, period: periods[0]! });
    expect(first.readyToAssign).toBe(900);
    expect(first.balance).toEqual({ cash: 850, inLines: -50, drift: 0 });

    const second = await pool({ planId, period: periods[1]! });
    expect(second.flow.fromLines).toBe(-50);
    expect(second.readyToAssign).toBe(850);

    const third = await pool({ planId, period: periods[2]! });
    expect(third.flow.fromLines).toBe(0);
    expect(third.readyToAssign).toBe(850);
    expect(third.balance).toEqual({ cash: 850, inLines: 0, drift: 0 });
  });

  it('returns a line leftover to the pool under the none carry policy', async () => {
    const { planId, periods, line, account, food } = await setup({
      carryPolicy: 'none',
    });

    await assign({ planId, period: periods[0]!, lineId: line.id, amount: 300 });
    await tx({
      accountId: account.id,
      categoryId: food.id,
      amount: 100,
      time: at({ period: periods[0]! }),
      transactionType: TRANSACTION_TYPES.expense,
    });

    expect((await pool({ planId, period: periods[0]! })).readyToAssign).toBe(700);

    const second = await pool({ planId, period: periods[1]! });
    expect(second.flow.fromLines).toBe(200);
    expect(second.readyToAssign).toBe(900);

    const third = await pool({ planId, period: periods[2]! });
    expect(third.flow.fromLines).toBe(0);
    expect(third.balance).toEqual({ cash: 900, inLines: 0, drift: 0 });
  });

  it('lets deleting income push readyToAssign negative', async () => {
    const { planId, periods, line, account, salary } = await setup();

    const [paycheck] = await tx({
      accountId: account.id,
      categoryId: salary.id,
      amount: 500,
      time: at({ period: periods[0]! }),
      transactionType: TRANSACTION_TYPES.income,
    });
    await assign({
      planId,
      period: periods[0]!,
      lineId: line.id,
      amount: 1200,
    });

    expect((await pool({ planId, period: periods[2]! })).readyToAssign).toBe(300);

    await helpers.deleteTransaction({ id: paycheck.id });

    expect((await pool({ planId, period: periods[2]! })).readyToAssign).toBe(-200);
  });
});

describe('Budget plan pool: account boundary', () => {
  it('ignores a transfer between two attached accounts', async () => {
    const { planId, periods, account, fun } = await setup();
    const second = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'second' }),
      raw: true,
    });
    await helpers.setBudgetPlanAccounts({
      planId,
      accountIds: [account.id, second.id],
      raw: true,
    });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 70,
          categoryId: fun.id,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 70,
          destinationAccountId: second.id,
        }),
        time: at({ period: periods[0]! }),
      },
      raw: true,
    });

    expect(await pool({ planId, period: periods[0]! })).toEqual({
      readyToAssign: 1000,
      committedLater: 0,
      flow: {
        leftOver: 1000,
        income: 0,
        outsideSpending: 0,
        fromLines: 0,
        assigned: 0,
      },
      balance: { cash: 1000, inLines: 0, drift: 0 },
    });
  });

  it('lowers the pool on a transfer out of the plan, or the line when its category is covered', async () => {
    const { planId, periods, account, fun, food } = await setup();
    const offPlan = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'off' }),
      raw: true,
    });

    const transferOut = ({ categoryId, amount, period }: { categoryId: RecordId; amount: number; period: Period }) =>
      helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: account.id,
            amount,
            categoryId,
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationAmount: amount,
            destinationAccountId: offPlan.id,
          }),
          time: at({ period }),
        },
        raw: true,
      });

    await transferOut({ categoryId: fun.id, amount: 300, period: periods[0]! });
    await transferOut({
      categoryId: food.id,
      amount: 200,
      period: periods[1]!,
    });

    const first = await pool({ planId, period: periods[0]! });
    expect(first.flow.outsideSpending).toBe(-300);
    expect(first.readyToAssign).toBe(700);
    expect(first.balance.drift).toBe(0);

    const second = await helpers.getBudgetPlanPeriodView({
      planId,
      periodId: periods[1]!.id,
      raw: true,
    });
    expect(second.lines[0]!.activity).toBe(-200);
    expect(second.pool!.flow.outsideSpending).toBe(0);
    expect(second.pool!.readyToAssign).toBe(700);
    expect(second.pool!.balance).toEqual({
      cash: 500,
      inLines: -200,
      drift: 0,
    });
  });

  it('counts a credit card by its debt, not its limit', async () => {
    const card = await helpers.createAccount({
      payload: helpers.buildAccountPayload({
        accountCategory: ACCOUNT_CATEGORIES.creditCard,
        initialBalance: 2000,
        creditLimit: 3000,
      }),
      raw: true,
    });
    const fun = await helpers.addCustomCategory({
      name: 'Fun',
      color: '#333333',
      raw: true,
    });
    const { plan } = await helpers.createBudgetPlan({
      payload: {
        accountIds: [card.id],
        epochDate: helpers.budgetPeriodStart({ monthsAgo: 1 }),
        poolEnabled: true,
      },
      raw: true,
    });
    const periods = await helpers.listBudgetPlanPeriods({
      planId: plan.id,
      raw: true,
    });

    await tx({
      accountId: card.id,
      categoryId: fun.id,
      amount: 100,
      time: at({ period: periods[0]! }),
      transactionType: TRANSACTION_TYPES.expense,
    });

    const result = await pool({ planId: plan.id, period: periods[0]! });
    expect(result.flow.leftOver).toBe(-1000);
    expect(result.readyToAssign).toBe(-1100);
    expect(result.balance).toEqual({ cash: -1100, inLines: 0, drift: 0 });
  });
});

describe('Budget plan pool: enabling on a plan with caps history', () => {
  it('starts at the current period and keeps money carried in lines out of the pool', async () => {
    const { planId, periods, line, account, food, salary } = await setup({
      poolEnabled: false,
      carryPolicy: 'floor',
    });

    await assign({ planId, period: periods[0]!, lineId: line.id, amount: 100 });
    await assign({ planId, period: periods[1]!, lineId: line.id, amount: 100 });
    await tx({
      accountId: account.id,
      categoryId: food.id,
      amount: 30,
      time: at({ period: periods[0]! }),
      transactionType: TRANSACTION_TYPES.expense,
    });
    await tx({
      accountId: account.id,
      categoryId: salary.id,
      amount: 500,
      time: at({ period: periods[0]! }),
      transactionType: TRANSACTION_TYPES.income,
    });

    const enabled = await helpers.updateBudgetPlan({
      planId,
      payload: { poolEnabled: true },
      raw: true,
    });
    expect(enabled.plan.poolFrom).toBe(periods[2]!.startDate);

    const again = await helpers.updateBudgetPlan({
      planId,
      payload: { poolEnabled: true },
      raw: true,
    });
    expect(again.plan.poolFrom).toBe(periods[2]!.startDate);

    const current = await helpers.getBudgetPlanPeriodView({
      planId,
      periodId: periods[2]!.id,
      raw: true,
    });
    expect(current.header.totalCarriedIn).toBe(170);
    expect(current.pool).toEqual({
      readyToAssign: 1300,
      committedLater: 0,
      flow: {
        leftOver: 1300,
        income: 0,
        outsideSpending: 0,
        fromLines: 0,
        assigned: 0,
      },
      balance: { cash: 1470, inLines: 170, drift: 0 },
    });

    const before = await helpers.getBudgetPlanPeriodView({
      planId,
      periodId: periods[1]!.id,
      raw: true,
    });
    expect(before.pool).toBeNull();

    const disabled = await helpers.updateBudgetPlan({
      planId,
      payload: { poolEnabled: false },
      raw: true,
    });
    expect(disabled.plan.poolFrom).toBeNull();
    expect(
      (
        await helpers.getBudgetPlanPeriodView({
          planId,
          periodId: periods[2]!.id,
          raw: true,
        })
      ).pool,
    ).toBeNull();
  });
});

describe('Budget plan pool: foreign currency', () => {
  const TODAY = startOfDay(new Date());
  const YESTERDAY = subDays(TODAY, 1);
  const epoch = new Date(`${helpers.budgetPeriodStart({ monthsAgo: 2 })}T00:00:00.000Z`);
  const DEPOSIT_DATE = subDays(epoch, 5);
  const SEEDED_DATES = [DEPOSIT_DATE, YESTERDAY, TODAY];

  afterEach(async () => {
    await helpers.clearExchangeRatesForDates({ dates: SEEDED_DATES });
  });

  it('shows a rate move as drift and leaves readyToAssign unchanged', async () => {
    await helpers.seedInrAedRates({
      depositDate: DEPOSIT_DATE,
      laterDates: [YESTERDAY, TODAY],
    });
    await helpers.addUserCurrencies({ currencyCodes: ['INR'] });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'INR' }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100_000,
        transactionType: TRANSACTION_TYPES.income,
        time: DEPOSIT_DATE.toISOString(),
      }),
      raw: true,
    });

    const food = await helpers.addCustomCategory({
      name: 'Food',
      color: '#111111',
      raw: true,
    });
    const { plan } = await helpers.createBudgetPlan({
      payload: {
        accountIds: [account.id],
        epochDate: helpers.budgetPeriodStart({ monthsAgo: 2 }),
        carryPolicy: 'signed',
        poolEnabled: true,
      },
      raw: true,
    });
    const periods = await helpers.listBudgetPlanPeriods({
      planId: plan.id,
      raw: true,
    });
    const line = await helpers.createBudgetPlanLine({
      planId: plan.id,
      payload: {
        name: 'Food',
        categoryIds: [food.id],
        activeFrom: periods[0]!.startDate,
      },
      raw: true,
    });

    const opening = 100_000 * helpers.INR_TO_AED_AT_DEPOSIT;
    const now = 100_000 * helpers.INR_TO_AED_AFTER;
    await assign({
      planId: plan.id,
      period: periods[0]!,
      lineId: line.id,
      amount: opening,
    });

    expect(await pool({ planId: plan.id, period: periods[2]! })).toEqual({
      readyToAssign: 0,
      committedLater: 0,
      flow: {
        leftOver: 0,
        income: 0,
        outsideSpending: 0,
        fromLines: 0,
        assigned: 0,
      },
      balance: { cash: now, inLines: opening, drift: now - opening },
    });
  }, 60_000);
});
