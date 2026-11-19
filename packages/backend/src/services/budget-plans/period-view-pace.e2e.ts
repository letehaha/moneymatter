import { type RecordId, SUBSCRIPTION_FREQUENCIES, TRANSACTION_TYPES } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

type Period = { id: string; startDate: string; endDate: string };

const DAY_MS = 86_400_000;

const daysBetween = ({ from, until }: { from: string; until: string }) =>
  Math.round((Date.parse(`${until}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);

const elapsedPercent = ({ period }: { period: Period }) => {
  const totalDays = daysBetween({ from: period.startDate, until: period.endDate });
  const today = toUtcDateString(new Date());
  const day = Math.min(totalDays, Math.max(0, daysBetween({ from: period.startDate, until: today }) + 1));
  return (day / totalDays) * 100;
};

const setup = async () => {
  const account = await helpers.createAccount({ raw: true });
  const { plan } = await helpers.createBudgetPlan({
    payload: { accountIds: [account.id], epochDate: helpers.budgetPeriodStart({ monthsAgo: 3 }) },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  const currentIndex = periods.findIndex((period) => period.isCurrent);

  const addLine = async ({ name, sortOrder, activeFrom }: { name: string; sortOrder: number; activeFrom: string }) => {
    const category = await helpers.addCustomCategory({ name, color: '#111111', raw: true });
    const line = await helpers.createBudgetPlanLine({
      planId: plan.id,
      payload: { name, categoryIds: [category.id], sortOrder, activeFrom },
      raw: true,
    });
    return { category, line };
  };

  const fund = ({ lineId, period, amount }: { lineId: string; period: Period; amount: number }) =>
    helpers.setBudgetAssignment({
      planId: plan.id,
      periodId: period.id,
      lineId,
      payload: { scope: 'from_here', amount },
      raw: true,
    });

  return {
    account,
    planId: plan.id,
    periods,
    prior: periods.slice(0, currentIndex),
    current: periods[currentIndex]!,
    addLine,
    fund,
  };
};

const paceOf = async ({ planId, period, lineId }: { planId: string; period: Period; lineId: string }) => {
  const view = await helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true });
  return view.lines.find((line) => line.lineId === lineId)!.pace;
};

const spendOnFirstDay = ({
  accountId,
  categoryId,
  period,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  period: Period;
}) =>
  helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId,
        categoryId,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      time: new Date(Date.parse(`${period.startDate}T12:00:00.000Z`)).toISOString(),
    },
    raw: true,
  });

describe('Budget plan period view: line pace', () => {
  it('uses history when the line spent everything on the first day of its last three periods', async () => {
    const { account, planId, periods, prior, current, addLine, fund } = await setup();
    const { category, line } = await addLine({ name: 'Food', sortOrder: 0, activeFrom: periods[0]!.startDate });
    await fund({ lineId: line.id, period: periods[0]!, amount: 1000 });

    expect(prior).toHaveLength(3);
    for (const period of prior) {
      await spendOnFirstDay({ accountId: account.id, categoryId: category.id, period });
    }

    expect(await paceOf({ planId, period: current, lineId: line.id })).toEqual({
      basis: 'history',
      expectedPercent: 100,
    });
  });

  it('uses the schedule for a new line whose only payment fell due on the first day', async () => {
    const { account, planId, current, addLine, fund } = await setup();
    const { category, line } = await addLine({ name: 'Gym', sortOrder: 0, activeFrom: current.startDate });
    await fund({ lineId: line.id, period: current, amount: 100 });
    await helpers.createSubscription({
      name: 'Gym',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: current.startDate,
      dueDate: current.startDate,
      accountId: account.id,
      categoryId: category.id,
      expectedAmount: 20,
      expectedCurrencyCode: global.BASE_CURRENCY_CODE,
      raw: true,
    });

    const pace = await paceOf({ planId, period: current, lineId: line.id });

    expect(pace?.basis).toBe('schedule');
    expect(pace!.expectedPercent).toBeGreaterThanOrEqual(20);
    expect(Math.abs(pace!.expectedPercent - (20 + 0.8 * elapsedPercent({ period: current })))).toBeLessThanOrEqual(
      0.01,
    );
  });

  it('falls back to time elapsed with no history and no recurring payments', async () => {
    const { planId, periods, current, addLine, fund } = await setup();
    const { line } = await addLine({ name: 'Books', sortOrder: 0, activeFrom: periods[0]!.startDate });
    await fund({ lineId: line.id, period: current, amount: 50 });

    const pace = await paceOf({ planId, period: current, lineId: line.id });

    expect(pace?.basis).toBe('even');
    expect(Math.abs(pace!.expectedPercent - elapsedPercent({ period: current }))).toBeLessThanOrEqual(0.01);
  });

  it('falls back to time elapsed when only one prior period had spending', async () => {
    const { account, planId, periods, prior, current, addLine, fund } = await setup();
    const { category, line } = await addLine({ name: 'Hobby', sortOrder: 0, activeFrom: periods[0]!.startDate });
    await fund({ lineId: line.id, period: periods[0]!, amount: 1000 });
    await spendOnFirstDay({ accountId: account.id, categoryId: category.id, period: prior.at(-1)! });

    const pace = await paceOf({ planId, period: current, lineId: line.id });

    expect(pace?.basis).toBe('even');
    expect(Math.abs(pace!.expectedPercent - elapsedPercent({ period: current }))).toBeLessThanOrEqual(0.01);
  });

  it('prefers history over a matching recurring payment', async () => {
    const { account, planId, periods, prior, current, addLine, fund } = await setup();
    const { category, line } = await addLine({ name: 'Streaming', sortOrder: 0, activeFrom: periods[0]!.startDate });
    await fund({ lineId: line.id, period: periods[0]!, amount: 1000 });
    for (const period of prior.slice(-2)) {
      await spendOnFirstDay({ accountId: account.id, categoryId: category.id, period });
    }
    await helpers.createSubscription({
      name: 'Streaming',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: current.startDate,
      dueDate: current.startDate,
      accountId: account.id,
      categoryId: category.id,
      expectedAmount: 20,
      expectedCurrencyCode: global.BASE_CURRENCY_CODE,
      raw: true,
    });

    expect(await paceOf({ planId, period: current, lineId: line.id })).toEqual({
      basis: 'history',
      expectedPercent: 100,
    });
  });

  it('gives no pace in a past period, even to a funded line', async () => {
    const { planId, periods, prior, addLine, fund } = await setup();
    const { line } = await addLine({ name: 'Books', sortOrder: 0, activeFrom: periods[0]!.startDate });
    await fund({ lineId: line.id, period: periods[0]!, amount: 50 });

    const view = await helpers.getBudgetPlanPeriodView({ planId, periodId: prior.at(-1)!.id, raw: true });

    expect(view.lines.length).toBeGreaterThan(0);
    expect(view.lines.every((entry) => entry.pace === null)).toBe(true);
  });

  it('gives no pace to an unfunded line in the current period', async () => {
    const { planId, periods, current, addLine, fund } = await setup();
    const funded = await addLine({ name: 'Books', sortOrder: 0, activeFrom: periods[0]!.startDate });
    const unfunded = await addLine({ name: 'Travel', sortOrder: 1, activeFrom: periods[0]!.startDate });
    await fund({ lineId: funded.line.id, period: current, amount: 50 });

    expect(await paceOf({ planId, period: current, lineId: funded.line.id })).not.toBeNull();
    expect(await paceOf({ planId, period: current, lineId: unfunded.line.id })).toBeNull();
  });
});
