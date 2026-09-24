import { SUBSCRIPTION_FREQUENCIES, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { toUtcDateString } from '@common/utils/date';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { startOfDay } from 'date-fns';

const plusDays = ({ date, days }: { date: string; days: number }) =>
  toUtcDateString(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000));

const setup = async () => {
  const account = await helpers.createAccount({ raw: true });
  const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
  const other = await helpers.addCustomCategory({ name: 'Other', color: '#222222', raw: true });

  const { plan } = await helpers.createBudgetPlan({
    payload: { accountIds: [account.id], epochDate: helpers.budgetPeriodStart({ monthsAgo: 1 }) },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  const line = await helpers.createBudgetPlanLine({
    planId: plan.id,
    payload: { name: 'Food', categoryIds: [food.id], activeFrom: periods[0]!.startDate },
    raw: true,
  });

  const current = periods.findIndex((period) => period.isCurrent);
  return {
    account,
    food,
    other,
    planId: plan.id,
    line,
    past: periods[current - 1]!,
    current: periods[current]!,
    next: periods[current + 1]!,
    afterNext: periods[current + 2]!,
  };
};

const subscription = ({
  frequency,
  ...rest
}: {
  name: string;
  frequency: SUBSCRIPTION_FREQUENCIES;
  startDate: string;
  dueDate?: string;
  endDate?: string;
  accountId?: string;
  categoryId?: string;
  expectedAmount?: number;
  expectedCurrencyCode?: string;
}) =>
  helpers.createSubscription({
    expectedAmount: 20,
    expectedCurrencyCode: global.BASE_CURRENCY_CODE,
    frequency,
    ...rest,
    raw: true,
  });

describe('GET /budget-plans/:planId/periods/:periodId/scheduled', () => {
  it('gives a monthly subscription exactly one item in each of its months', async () => {
    const { planId, account, food, line, next, afterNext } = await setup();
    const dueDate = plusDays({ date: next.startDate, days: 14 });
    await subscription({
      name: 'Gym',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: dueDate,
      dueDate,
      accountId: account.id,
      categoryId: food.id,
    });

    const result = await helpers.getBudgetPlanScheduled({ planId, periodId: next.id, raw: true });

    expect(result.items).toEqual([
      expect.objectContaining({
        source: 'subscription',
        name: 'Gym',
        date: dueDate,
        amount: -20,
        nativeAmount: -20,
        currencyCode: global.BASE_CURRENCY_CODE,
        categoryId: food.id,
        lineId: line.id,
        accountId: account.id,
      }),
    ]);
    expect(result.outflows).toEqual({ total: -20, count: 1 });
    expect(result.inflows).toEqual({ total: 0, count: 0 });
    expect(result.nextDate).toBe(dueDate);

    const later = await helpers.getBudgetPlanScheduled({ planId, periodId: afterNext.id, raw: true });
    expect(later.items.map((item) => item.date)).toEqual([plusDays({ date: afterNext.startDate, days: 14 })]);
  });

  it('gives a weekly subscription one item per week inside the period', async () => {
    const { planId, account, next } = await setup();
    const startDate = plusDays({ date: next.startDate, days: 2 });
    await subscription({
      name: 'Box',
      frequency: SUBSCRIPTION_FREQUENCIES.weekly,
      startDate,
      accountId: account.id,
    });

    const expected: string[] = [];
    for (let date = startDate; date < next.endDate; date = plusDays({ date, days: 7 })) expected.push(date);

    const result = await helpers.getBudgetPlanScheduled({ planId, periodId: next.id, raw: true });

    expect(expected.length).toBeGreaterThanOrEqual(4);
    expect(result.items.map((item) => item.date)).toEqual(expected);
    expect(result.outflows).toEqual({ total: -20 * expected.length, count: expected.length });
  });

  it('includes planned transactions on attached accounts', async () => {
    const { planId, account, food, line, next } = await setup();
    const outDate = plusDays({ date: next.startDate, days: 5 });
    const inDate = plusDays({ date: next.startDate, days: 3 });
    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        categoryId: food.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.expense,
        time: `${outDate}T12:00:00.000Z`,
        note: 'Groceries run',
      },
      raw: true,
    });
    await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 200,
        transactionType: TRANSACTION_TYPES.income,
        time: `${inDate}T12:00:00.000Z`,
      },
      raw: true,
    });

    const result = await helpers.getBudgetPlanScheduled({ planId, periodId: next.id, raw: true });

    expect(result.items).toEqual([
      expect.objectContaining({ source: 'planned', date: inDate, amount: 200, lineId: null }),
      expect.objectContaining({
        source: 'planned',
        name: 'Groceries run',
        date: outDate,
        amount: -50,
        nativeAmount: -50,
        categoryId: food.id,
        lineId: line.id,
        accountId: account.id,
      }),
    ]);
    expect(result.outflows).toEqual({ total: -50, count: 1 });
    expect(result.inflows).toEqual({ total: 200, count: 1 });
    expect(result.nextDate).toBe(inDate);
  });

  it('keeps a subscription only when its account is attached, or it has none and a line covers its category', async () => {
    const { planId, food, other, next } = await setup();
    const outside = await helpers.createAccount({ raw: true });
    const startDate = plusDays({ date: next.startDate, days: 9 });
    const monthly = SUBSCRIPTION_FREQUENCIES.monthly;

    await subscription({
      name: 'Unattached',
      frequency: monthly,
      startDate,
      accountId: outside.id,
      categoryId: food.id,
    });
    await subscription({ name: 'No account, covered', frequency: monthly, startDate, categoryId: food.id });
    await subscription({ name: 'No account, uncovered', frequency: monthly, startDate, categoryId: other.id });

    const result = await helpers.getBudgetPlanScheduled({ planId, periodId: next.id, raw: true });

    expect(result.items.map((item) => item.name)).toEqual(['No account, covered']);
    expect(result.items[0]!.accountId).toBeNull();
  });

  it("shows a planned transaction linked to a subscription in place of that day's occurrence", async () => {
    const { planId, account, next } = await setup();
    const startDate = plusDays({ date: next.startDate, days: 2 });
    const sub = await subscription({
      name: 'Box',
      frequency: SUBSCRIPTION_FREQUENCIES.weekly,
      startDate,
      accountId: account.id,
    });
    const [planned] = await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 20,
        transactionType: TRANSACTION_TYPES.expense,
        time: `${startDate}T12:00:00.000Z`,
      },
      raw: true,
    });
    await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [planned.id], raw: true });

    const expected: string[] = [];
    for (let date = startDate; date < next.endDate; date = plusDays({ date, days: 7 })) expected.push(date);

    const result = await helpers.getBudgetPlanScheduled({ planId, periodId: next.id, raw: true });

    expect(result.items.filter((item) => item.date === startDate)).toEqual([
      expect.objectContaining({ source: 'planned', id: planned.id }),
    ]);
    expect(result.items.filter((item) => item.date !== startDate).map((item) => [item.source, item.date])).toEqual(
      expected.slice(1).map((date) => ['subscription', date]),
    );
    expect(result.outflows.count).toBe(expected.length);
  });

  it('stops a subscription at its end date', async () => {
    const { planId, account, next } = await setup();
    const startDate = plusDays({ date: next.startDate, days: 2 });
    const endDate = plusDays({ date: startDate, days: 14 });
    await subscription({
      name: 'Box',
      frequency: SUBSCRIPTION_FREQUENCIES.weekly,
      startDate,
      endDate,
      accountId: account.id,
    });

    const result = await helpers.getBudgetPlanScheduled({ planId, periodId: next.id, raw: true });

    expect(result.items.map((item) => item.date)).toEqual([startDate, plusDays({ date: startDate, days: 7 }), endDate]);
    expect(result.outflows.count).toBe(3);
  });

  it('converts a foreign-currency subscription into the plan currency', async () => {
    await helpers.seedUsdExchangeRates({
      date: startOfDay(new Date()),
      ratesPerUsd: { AED: helpers.AED_PER_USD, INR: helpers.INR_PER_USD_AFTER },
    });
    await helpers.addUserCurrencies({ currencyCodes: ['INR'] });
    const { planId, account, next } = await setup();
    const dueDate = plusDays({ date: next.startDate, days: 4 });
    await subscription({
      name: 'Streaming',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: dueDate,
      accountId: account.id,
      expectedAmount: 64,
      expectedCurrencyCode: 'INR',
    });

    const result = await helpers.getBudgetPlanScheduled({ planId, periodId: next.id, raw: true });

    expect(result.items).toEqual([
      expect.objectContaining({
        source: 'subscription',
        currencyCode: 'INR',
        nativeAmount: -64,
        amount: -64 * helpers.INR_TO_AED_AFTER,
      }),
    ]);
  });

  it('returns nothing for a past period', async () => {
    const { planId, account, past } = await setup();
    await subscription({
      name: 'Box',
      frequency: SUBSCRIPTION_FREQUENCIES.weekly,
      startDate: past.startDate,
      accountId: account.id,
    });

    const result = await helpers.getBudgetPlanScheduled({ planId, periodId: past.id, raw: true });

    expect(result).toEqual({
      items: [],
      outflows: { total: 0, count: 0 },
      inflows: { total: 0, count: 0 },
      nextDate: null,
    });
  });

  it('returns an empty result when nothing is scheduled', async () => {
    const { planId, current } = await setup();

    const result = await helpers.getBudgetPlanScheduled({ planId, periodId: current.id, raw: true });

    expect(result.items).toEqual([]);
    expect(result.nextDate).toBeNull();
  });

  it('404s on an unknown plan or a period outside the plan', async () => {
    const { planId, current } = await setup();

    const unknownPlan = await helpers.getBudgetPlanScheduled({
      planId: generateRandomRecordId(),
      periodId: current.id,
    });
    expect(unknownPlan.statusCode).toBe(ERROR_CODES.NotFoundError);

    const unknownPeriod = await helpers.getBudgetPlanScheduled({ planId, periodId: generateRandomRecordId() });
    expect(unknownPeriod.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});
