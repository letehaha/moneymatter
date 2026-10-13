import { TRANSACTION_TYPES } from '@bt/shared/types';
import type { BudgetPlanCarryPolicy } from '@bt/shared/types';
import {
  BUDGET_LINE_GOAL_BEHAVIORS_BY_FREQUENCY,
  BUDGET_LINE_GOAL_FREQUENCIES,
  type BudgetLineGoalFrequency,
  type SetBudgetLineGoalPayload,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

import { MS_PER_DAY } from './periods/period-enumerator';

type Period = { id: string; startDate: string; endDate: string };

const CURRENT = 2;

const setup = async ({
  carryPolicy = 'floor',
  initialBalance = 700,
  poolEnabled = false,
}: {
  carryPolicy?: BudgetPlanCarryPolicy;
  initialBalance?: number;
  poolEnabled?: boolean;
} = {}) => {
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ initialBalance }),
    raw: true,
  });
  const { plan } = await helpers.createBudgetPlan({
    payload: {
      accountIds: [account.id],
      epochDate: helpers.budgetPeriodStart({ monthsAgo: CURRENT }),
      carryPolicy,
      poolEnabled,
    },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });

  const addLine = async ({ name, from = 0 }: { name: string; from?: number }) => {
    const category = await helpers.addCustomCategory({ name, color: '#111111', raw: true });
    const line = await helpers.createBudgetPlanLine({
      planId: plan.id,
      payload: { name, categoryIds: [category.id], activeFrom: periods[from]!.startDate },
      raw: true,
    });
    return { ...line, categoryId: category.id };
  };

  return { planId: plan.id, accountId: account.id, periods, addLine };
};

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

const view = ({ planId, period }: { planId: string; period: Period }) =>
  helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true });

const setGoal = ({ planId, lineId, payload }: { planId: string; lineId: string; payload: SetBudgetLineGoalPayload }) =>
  helpers.setBudgetLineGoal({ planId, lineId, payload, raw: true });

const goalOf = ({ result, lineId }: { result: Awaited<ReturnType<typeof view>>; lineId: string }) =>
  result.lines.find((entry) => entry.lineId === lineId)!.goal;

const addDays = ({ date, days }: { date: string; days: number }) =>
  new Date(Date.parse(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
const daysIn = ({ period }: { period: Period }) =>
  (Date.parse(period.endDate) - Date.parse(period.startDate)) / MS_PER_DAY;

describe('Budget line goals: CRUD', () => {
  it('returns goal: null and goals: null when no line has a goal', async () => {
    const { planId, periods, addLine } = await setup();
    await addLine({ name: 'Food' });

    const result = await view({ planId, period: periods[CURRENT]! });

    expect(result.lines[0]!.goal).toBeNull();
    expect(result.goals).toBeNull();
  });

  it('creates, replaces and deletes a goal', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Food' });

    const created = await setGoal({
      planId,
      lineId: line.id,
      payload: { frequency: 'every_period', behavior: 'budget_another', amount: 100.5, stopAtBalance: 300 },
    });
    expect(created).toEqual({
      lineId: line.id,
      frequency: 'every_period',
      behavior: 'budget_another',
      amount: 100.5,
      weekday: null,
      anchorDate: null,
      repeatEvery: null,
      repeatUnit: null,
      stopAtBalance: 300,
      fundingCap: null,
      startPeriodStart: periods[CURRENT]!.startDate,
      snoozedPeriodStart: null,
    });

    const anchorDate = periods[CURRENT + 3]!.startDate;
    const replaced = await setGoal({
      planId,
      lineId: line.id,
      payload: { frequency: 'by_date', behavior: 'reach_balance', amount: 900, anchorDate },
    });
    expect(replaced).toMatchObject({
      frequency: 'by_date',
      behavior: 'reach_balance',
      amount: 900,
      anchorDate,
      stopAtBalance: null,
      startPeriodStart: periods[CURRENT]!.startDate,
    });

    const withGoal = await view({ planId, period: periods[CURRENT]! });
    expect(withGoal.lines[0]!.goal).toMatchObject({
      frequency: 'by_date',
      behavior: 'reach_balance',
      amount: 900,
      anchorDate,
      dueDate: anchorDate,
    });
    expect(withGoal.goals!.count).toBe(1);

    const deleted = await helpers.deleteBudgetLineGoal({ planId, lineId: line.id });
    expect(deleted.statusCode).toBe(200);

    const after = await view({ planId, period: periods[CURRENT]! });
    expect(after.lines[0]!.goal).toBeNull();
    expect(after.goals).toBeNull();
  });

  it('saves every frequency with each behavior it allows', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Food' });
    const future = periods[CURRENT + 3]!.startDate;
    const settings: Record<BudgetLineGoalFrequency, { weekday?: number; anchorDate?: string }> = {
      every_period: {},
      weekly: { weekday: 1 },
      biweekly: { anchorDate: periods[0]!.startDate },
      yearly: { anchorDate: future },
      by_date: { anchorDate: future },
      open_ended: {},
    };

    for (const frequency of BUDGET_LINE_GOAL_FREQUENCIES) {
      for (const behavior of BUDGET_LINE_GOAL_BEHAVIORS_BY_FREQUENCY[frequency]) {
        const saved = await setGoal({
          planId,
          lineId: line.id,
          payload: { frequency, behavior, amount: 50, ...settings[frequency] },
        });
        const expected = {
          frequency,
          behavior,
          amount: 50,
          weekday: settings[frequency].weekday ?? null,
          anchorDate: settings[frequency].anchorDate ?? null,
        };
        expect(saved).toMatchObject(expected);
        expect((await view({ planId, period: periods[CURRENT]! })).lines[0]!.goal).toMatchObject(expected);
      }
    }
  });

  it('returns 422 for every combination the goal rules reject', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Food' });
    const future = periods[CURRENT + 2]!.startDate;
    const past = periods[0]!.startDate;

    const payloads: Record<string, unknown>[] = [
      { frequency: 'every_period', behavior: 'reach_balance', amount: 10 },
      { frequency: 'weekly', behavior: 'reach_balance', amount: 10, weekday: 1 },
      { frequency: 'biweekly', behavior: 'reach_balance', amount: 10, anchorDate: past },
      { frequency: 'yearly', behavior: 'reach_balance', amount: 10, anchorDate: future },
      { frequency: 'open_ended', behavior: 'budget_another', amount: 10 },
      { frequency: 'open_ended', behavior: 'refill_up_to', amount: 10 },
      { frequency: 'weekly', behavior: 'budget_another', amount: 10 },
      { frequency: 'weekly', behavior: 'budget_another', amount: 10, weekday: 7 },
      { frequency: 'every_period', behavior: 'budget_another', amount: 10, weekday: 1 },
      { frequency: 'biweekly', behavior: 'budget_another', amount: 10, weekday: 1 },
      { frequency: 'biweekly', behavior: 'budget_another', amount: 10 },
      { frequency: 'yearly', behavior: 'budget_another', amount: 10 },
      { frequency: 'by_date', behavior: 'reach_balance', amount: 10 },
      { frequency: 'every_period', behavior: 'budget_another', amount: 10, anchorDate: future },
      { frequency: 'open_ended', behavior: 'reach_balance', amount: 10, anchorDate: future },
      { frequency: 'by_date', behavior: 'reach_balance', amount: 10, anchorDate: past },
      { frequency: 'by_date', behavior: 'budget_another', amount: 10, anchorDate: future, repeatEvery: 2 },
      { frequency: 'by_date', behavior: 'budget_another', amount: 10, anchorDate: future, repeatUnit: 'months' },
      {
        frequency: 'by_date',
        behavior: 'reach_balance',
        amount: 10,
        anchorDate: future,
        repeatEvery: 2,
        repeatUnit: 'months',
      },
      {
        frequency: 'yearly',
        behavior: 'budget_another',
        amount: 10,
        anchorDate: future,
        repeatEvery: 1,
        repeatUnit: 'years',
      },
      {
        frequency: 'by_date',
        behavior: 'refill_up_to',
        amount: 10,
        anchorDate: future,
        repeatEvery: 12,
        repeatUnit: 'months',
      },
      {
        frequency: 'by_date',
        behavior: 'refill_up_to',
        amount: 10,
        anchorDate: future,
        repeatEvery: 6,
        repeatUnit: 'years',
      },
      {
        frequency: 'by_date',
        behavior: 'refill_up_to',
        amount: 10,
        anchorDate: future,
        repeatEvery: 0,
        repeatUnit: 'months',
      },
      { frequency: 'every_period', behavior: 'refill_up_to', amount: 10, stopAtBalance: 50 },
      { frequency: 'every_period', behavior: 'budget_another', amount: 10, stopAtBalance: 0 },
      { frequency: 'every_period', behavior: 'budget_another', amount: 10, fundingCap: 5 },
      { frequency: 'by_date', behavior: 'reach_balance', amount: 10, anchorDate: future, fundingCap: 5 },
      { frequency: 'every_period', behavior: 'refill_up_to', amount: 10, fundingCap: -1 },
      { frequency: 'every_period', behavior: 'budget_another', amount: 0 },
      { frequency: 'every_period', behavior: 'budget_another', amount: -5 },
      { frequency: 'every_period', behavior: 'budget_another', amount: 10.005 },
      { frequency: 'monthly', behavior: 'budget_another', amount: 10 },
      { behavior: 'budget_another', amount: 10 },
    ];

    for (const payload of payloads) {
      const res = await helpers.setBudgetLineGoal({
        planId,
        lineId: line.id,
        payload: payload as unknown as SetBudgetLineGoalPayload,
      });
      expect({ payload, statusCode: res.statusCode }).toEqual({ payload, statusCode: ERROR_CODES.ValidationError });
    }
  });

  it('returns 404 for an unknown line, an unknown start period, and deleting a missing goal', async () => {
    const { planId, addLine } = await setup();
    const line = await addLine({ name: 'Food' });
    const payload = { frequency: 'every_period', behavior: 'budget_another', amount: 10 } as const;

    const unknown = await helpers.setBudgetLineGoal({ planId, lineId: generateRandomRecordId(), payload });
    expect(unknown.statusCode).toBe(ERROR_CODES.NotFoundError);

    const unknownPeriod = await helpers.setBudgetLineGoal({
      planId,
      lineId: line.id,
      payload: { ...payload, periodId: generateRandomRecordId() },
    });
    expect(unknownPeriod.statusCode).toBe(ERROR_CODES.NotFoundError);

    expect((await helpers.deleteBudgetLineGoal({ planId, lineId: line.id })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
  });

  it('starts the goal in the given period and keeps that start on update', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Food' });
    const started = periods[CURRENT - 1]!.startDate;

    const created = await setGoal({
      planId,
      lineId: line.id,
      payload: {
        frequency: 'every_period',
        behavior: 'budget_another',
        amount: 10,
        periodId: periods[CURRENT - 1]!.id,
      },
    });
    expect(created.startPeriodStart).toBe(started);

    const updated = await setGoal({
      planId,
      lineId: line.id,
      payload: { frequency: 'every_period', behavior: 'refill_up_to', amount: 20, periodId: periods[0]!.id },
    });
    expect(updated).toMatchObject({ behavior: 'refill_up_to', amount: 20, startPeriodStart: started });
    expect((await view({ planId, period: periods[CURRENT]! })).lines[0]!.goal!.startPeriodStart).toBe(started);
  });
});

describe('Budget line goals: ask and status in the period view', () => {
  it('builds the funding plan of a dated balance (Zerosum: 6500 by the 28th, 7 periods, 3000 held, 500 assigned)', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Savings' });
    await assign({ planId, period: periods[CURRENT - 1]!, lineId: line.id, amount: 2500 });
    await assign({ planId, period: periods[CURRENT]!, lineId: line.id, amount: 500 });
    const anchorDate = `${periods[CURRENT + 6]!.startDate.slice(0, 8)}28`;

    await setGoal({
      planId,
      lineId: line.id,
      payload: { frequency: 'by_date', behavior: 'reach_balance', amount: 6500, anchorDate },
    });

    const result = await view({ planId, period: periods[CURRENT]! });
    const rows = [
      [71.43, 3428.57],
      [571.43, 2857.14],
      [571.43, 2285.71],
      [571.43, 1714.28],
      [571.43, 1142.85],
      [571.43, 571.42],
      [571.42, 0],
    ].map(([amount, leftAfter], index) => ({ periodStart: periods[CURRENT + index]!.startDate, amount, leftAfter }));

    expect(result.lines[0]!.goal).toEqual({
      frequency: 'by_date',
      behavior: 'reach_balance',
      amount: 6500,
      weekday: null,
      anchorDate,
      repeatEvery: null,
      repeatUnit: null,
      stopAtBalance: null,
      fundingCap: null,
      startPeriodStart: periods[CURRENT]!.startDate,
      dueDate: anchorDate,
      ask: 71.43,
      target: 6500,
      periodTarget: 571.43,
      progress: 3000,
      status: 'underfunded',
      budgetAmount: 71.43,
      occurrences: null,
      fundedThrough: null,
      nextNeededDate: null,
      fundingPlan: rows,
    });
    expect(result.goals).toEqual({
      count: 1,
      totalTarget: 571.43,
      stillNeeded: 71.43,
      underfunded: [{ lineId: line.id, ask: 71.43 }],
      expectedIncome: null,
    });
  });

  it('reports underfunded, funded and achieved goals together', async () => {
    const { planId, periods, addLine } = await setup();
    const [food, rent, buffer] = await Promise.all([
      addLine({ name: 'Food' }),
      addLine({ name: 'Rent' }),
      addLine({ name: 'Buffer' }),
    ]);
    const period = periods[CURRENT]!;
    await assign({ planId, period, lineId: food.id, amount: 40 });
    await assign({ planId, period, lineId: rent.id, amount: 50 });
    await assign({ planId, period, lineId: buffer.id, amount: 30 });

    await setGoal({
      planId,
      lineId: food.id,
      payload: { frequency: 'every_period', behavior: 'budget_another', amount: 100 },
    });
    await setGoal({
      planId,
      lineId: rent.id,
      payload: { frequency: 'every_period', behavior: 'refill_up_to', amount: 50 },
    });
    await setGoal({
      planId,
      lineId: buffer.id,
      payload: { frequency: 'open_ended', behavior: 'reach_balance', amount: 20 },
    });

    const result = await view({ planId, period });

    expect(goalOf({ result, lineId: food.id })).toMatchObject({
      ask: 60,
      target: 100,
      progress: 40,
      status: 'underfunded',
    });
    expect(goalOf({ result, lineId: rent.id })).toMatchObject({ ask: 0, target: 50, progress: 50, status: 'funded' });
    expect(goalOf({ result, lineId: buffer.id })).toMatchObject({
      ask: 0,
      target: 20,
      progress: 30,
      status: 'achieved',
      budgetAmount: 0,
    });
    expect(result.goals).toEqual({
      count: 3,
      totalTarget: 150,
      stillNeeded: 60,
      underfunded: [{ lineId: food.id, ask: 60 }],
      expectedIncome: null,
    });
  });

  it('asks per weekday occurrence on a monthly plan: 5 for the first weekday, 4 for the day before it', async () => {
    const { planId, periods, addLine } = await setup();
    const period = periods.slice(CURRENT, CURRENT + 3).find((entry) => daysIn({ period: entry }) > 28)!;
    const [five, four] = await Promise.all([addLine({ name: 'Five' }), addLine({ name: 'Four' })]);
    const firstWeekday = new Date(Date.parse(period.startDate)).getUTCDay();

    await setGoal({
      planId,
      lineId: five.id,
      payload: { frequency: 'weekly', behavior: 'budget_another', amount: 25, weekday: firstWeekday },
    });
    await setGoal({
      planId,
      lineId: four.id,
      payload: { frequency: 'weekly', behavior: 'budget_another', amount: 25, weekday: (firstWeekday + 6) % 7 },
    });
    await assign({ planId, period, lineId: five.id, amount: 60 });

    const result = await view({ planId, period });
    const fiveDates = [0, 7, 14, 21, 28].map((days) => addDays({ date: period.startDate, days }));
    const fourDates = [6, 13, 20, 27].map((days) => addDays({ date: period.startDate, days }));

    expect(goalOf({ result, lineId: five.id })).toMatchObject({
      target: 125,
      progress: 60,
      ask: 65,
      budgetAmount: 65,
      status: 'underfunded',
      occurrences: fiveDates,
      fundedThrough: fiveDates[1],
      nextNeededDate: fiveDates[2],
    });
    expect(goalOf({ result, lineId: four.id })).toMatchObject({
      target: 100,
      progress: 0,
      ask: 100,
      occurrences: fourDates,
      fundedThrough: null,
      nextNeededDate: fourDates[0],
    });
  });

  it('shrinks a yearly ask by what earlier periods of the cycle assigned', async () => {
    const { planId, periods, addLine } = await setup();
    const [funded, fresh] = await Promise.all([addLine({ name: 'Insurance' }), addLine({ name: 'Fresh' })]);
    const anchorDate = periods[CURRENT + 2]!.startDate;
    const payload = {
      frequency: 'yearly',
      behavior: 'budget_another',
      amount: 1200,
      anchorDate,
      periodId: periods[CURRENT - 1]!.id,
    } as const;
    await setGoal({ planId, lineId: funded.id, payload });
    await setGoal({ planId, lineId: fresh.id, payload });
    await assign({ planId, period: periods[CURRENT - 1]!, lineId: funded.id, amount: 300 });

    const result = await view({ planId, period: periods[CURRENT]! });

    expect(goalOf({ result, lineId: fresh.id })).toMatchObject({ ask: 400, target: 1200, dueDate: anchorDate });
    expect(goalOf({ result, lineId: funded.id })).toMatchObject({
      ask: 300,
      target: 1200,
      progress: 300,
      dueDate: anchorDate,
      fundingPlan: [
        { periodStart: periods[CURRENT]!.startDate, amount: 300, leftAfter: 600 },
        { periodStart: periods[CURRENT + 1]!.startDate, amount: 300, leftAfter: 300 },
        { periodStart: periods[CURRENT + 2]!.startDate, amount: 300, leftAfter: 0 },
      ],
    });
  });

  it('counts a by-date budget_another from its start period only', async () => {
    const { planId, periods, addLine } = await setup();
    const [early, late] = await Promise.all([addLine({ name: 'Early' }), addLine({ name: 'Late' })]);
    const anchorDate = periods[CURRENT + 1]!.startDate;
    const payload = { frequency: 'by_date', behavior: 'budget_another', amount: 600, anchorDate } as const;
    await setGoal({ planId, lineId: early.id, payload: { ...payload, periodId: periods[CURRENT - 1]!.id } });
    await setGoal({ planId, lineId: late.id, payload });
    await assign({ planId, period: periods[CURRENT - 1]!, lineId: early.id, amount: 200 });
    await assign({ planId, period: periods[CURRENT - 1]!, lineId: late.id, amount: 200 });

    const result = await view({ planId, period: periods[CURRENT]! });

    expect(goalOf({ result, lineId: early.id })).toMatchObject({ ask: 200, progress: 200, dueDate: anchorDate });
    expect(goalOf({ result, lineId: late.id })).toMatchObject({ ask: 300, progress: 0, dueDate: anchorDate });
  });

  it('rolls a repeating by-date goal into its next cycle after the due period', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Quarterly' });
    await setGoal({
      planId,
      lineId: line.id,
      payload: {
        frequency: 'by_date',
        behavior: 'budget_another',
        amount: 300,
        anchorDate: periods[CURRENT - 1]!.startDate,
        repeatEvery: 3,
        repeatUnit: 'months',
        periodId: periods[0]!.id,
      },
    });
    await assign({ planId, period: periods[CURRENT - 1]!, lineId: line.id, amount: 300 });

    const duePeriod = await view({ planId, period: periods[CURRENT - 1]! });
    expect(duePeriod.lines[0]!.goal).toMatchObject({
      ask: 0,
      status: 'funded',
      dueDate: periods[CURRENT - 1]!.startDate,
    });

    const nextCycle = await view({ planId, period: periods[CURRENT]! });
    expect(nextCycle.lines[0]!.goal).toMatchObject({
      ask: 100,
      progress: 0,
      status: 'underfunded',
      dueDate: periods[CURRENT + 2]!.startDate,
    });
  });

  it('stops asking at the stop-at balance and caps a refill at the funding cap', async () => {
    const { planId, periods, addLine } = await setup();
    const [stopping, capped] = await Promise.all([addLine({ name: 'Stopping' }), addLine({ name: 'Capped' })]);
    await assign({ planId, period: periods[CURRENT - 1]!, lineId: stopping.id, amount: 200 });
    await setGoal({
      planId,
      lineId: stopping.id,
      payload: { frequency: 'every_period', behavior: 'budget_another', amount: 100, stopAtBalance: 250 },
    });
    await setGoal({
      planId,
      lineId: capped.id,
      payload: { frequency: 'every_period', behavior: 'refill_up_to', amount: 500, fundingCap: 120 },
    });

    const result = await view({ planId, period: periods[CURRENT]! });

    expect(goalOf({ result, lineId: stopping.id })).toMatchObject({
      ask: 50,
      stopAtBalance: 250,
      status: 'underfunded',
    });
    expect(goalOf({ result, lineId: capped.id })).toMatchObject({ ask: 120, target: 500, fundingCap: 120 });
  });

  it('adds an overspend to the Budget amount of an every-period goal', async () => {
    const { planId, accountId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Food' });
    const period = periods[CURRENT]!;
    await assign({ planId, period, lineId: line.id, amount: 30 });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId,
          categoryId: line.categoryId,
          amount: 80,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        time: new Date(Date.parse(period.startDate) + 12 * 3_600_000).toISOString(),
      },
      raw: true,
    });
    await setGoal({
      planId,
      lineId: line.id,
      payload: { frequency: 'every_period', behavior: 'budget_another', amount: 100 },
    });

    const result = await view({ planId, period });

    expect(result.lines[0]!.available).toBe(-50);
    expect(result.lines[0]!.goal).toMatchObject({ ask: 70, budgetAmount: 120, status: 'underfunded' });
  });
});

describe('Budget line goals: snooze', () => {
  it('toggles a snooze for one period', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Food' });
    await setGoal({
      planId,
      lineId: line.id,
      payload: { frequency: 'every_period', behavior: 'budget_another', amount: 100 },
    });
    const period = periods[CURRENT]!;

    const snoozed = await helpers.snoozeBudgetLineGoal({ planId, lineId: line.id, periodId: period.id, raw: true });
    expect(snoozed.snoozedPeriodStart).toBe(period.startDate);

    const during = await view({ planId, period });
    expect(during.lines[0]!.goal).toMatchObject({ ask: 0, status: 'snoozed' });
    expect(during.goals).toMatchObject({ stillNeeded: 0, underfunded: [] });
    expect((await view({ planId, period: periods[CURRENT + 1]! })).lines[0]!.goal).toMatchObject({
      ask: 100,
      status: 'underfunded',
    });

    const woken = await helpers.snoozeBudgetLineGoal({ planId, lineId: line.id, periodId: period.id, raw: true });
    expect(woken.snoozedPeriodStart).toBeNull();
    expect((await view({ planId, period })).lines[0]!.goal).toMatchObject({ ask: 100, status: 'underfunded' });
  });

  it('returns 404 without a goal or for a period of another plan', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Food' });

    expect(
      (await helpers.snoozeBudgetLineGoal({ planId, lineId: line.id, periodId: periods[CURRENT]!.id })).statusCode,
    ).toBe(ERROR_CODES.NotFoundError);

    await setGoal({
      planId,
      lineId: line.id,
      payload: { frequency: 'every_period', behavior: 'budget_another', amount: 100 },
    });
    expect(
      (await helpers.snoozeBudgetLineGoal({ planId, lineId: line.id, periodId: generateRandomRecordId() })).statusCode,
    ).toBe(ERROR_CODES.NotFoundError);
  });

  it("hides another user's plan behind a 404", async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Food' });
    const payload: SetBudgetLineGoalPayload = { frequency: 'every_period', behavior: 'budget_another', amount: 100 };
    await setGoal({ planId, lineId: line.id, payload });

    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const statusCodes = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => [
        (await helpers.setBudgetLineGoal({ planId, lineId: line.id, payload })).statusCode,
        (await helpers.snoozeBudgetLineGoal({ planId, lineId: line.id, periodId: periods[CURRENT]!.id })).statusCode,
        (await helpers.deleteBudgetLineGoal({ planId, lineId: line.id })).statusCode,
      ],
    });

    expect(statusCodes).toEqual(Array(3).fill(ERROR_CODES.NotFoundError));
  });

  it('returns 422 for an open-ended goal', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Savings' });
    await setGoal({
      planId,
      lineId: line.id,
      payload: { frequency: 'open_ended', behavior: 'reach_balance', amount: 500 },
    });

    expect(
      (await helpers.snoozeBudgetLineGoal({ planId, lineId: line.id, periodId: periods[CURRENT]!.id })).statusCode,
    ).toBe(ERROR_CODES.ValidationError);
  });
});

describe('Budget plan expectedIncome', () => {
  it('round-trips through update, the plan and the goals summary', async () => {
    const { planId, periods, addLine } = await setup();
    const line = await addLine({ name: 'Food' });
    await helpers.setBudgetLineGoal({
      planId,
      lineId: line.id,
      payload: { frequency: 'every_period', behavior: 'budget_another', amount: 100 },
      raw: true,
    });

    const updated = await helpers.updateBudgetPlan({ planId, payload: { expectedIncome: 2500.5 }, raw: true });
    expect(updated.plan.expectedIncome).toBe(2500.5);
    expect((await helpers.getBudgetPlan({ planId, raw: true })).plan.expectedIncome).toBe(2500.5);
    expect((await view({ planId, period: periods[CURRENT]! })).goals!.expectedIncome).toBe(2500.5);

    const cleared = await helpers.updateBudgetPlan({ planId, payload: { expectedIncome: null }, raw: true });
    expect(cleared.plan.expectedIncome).toBeNull();
    expect((await view({ planId, period: periods[CURRENT]! })).goals!.expectedIncome).toBeNull();
  });

  it('rejects a negative expectedIncome', async () => {
    const { planId } = await setup();

    expect((await helpers.updateBudgetPlan({ planId, payload: { expectedIncome: -1 } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
  });
});

describe('Budget plan next-period coverage', () => {
  // Floor carry, 700 cash: Food assigns 100/200/300 over the three periods and
  // Fun (current period only) 60, leaving 40 ready to assign.
  const history = async ({ initialBalance = 700 }: { initialBalance?: number } = {}) => {
    const ctx = await setup({ poolEnabled: true, initialBalance });
    const food = await ctx.addLine({ name: 'Food' });
    const fun = await ctx.addLine({ name: 'Fun', from: CURRENT });
    await assign({ planId: ctx.planId, period: ctx.periods[0]!, lineId: food.id, amount: 100 });
    await assign({ planId: ctx.planId, period: ctx.periods[1]!, lineId: food.id, amount: 200 });
    await assign({ planId: ctx.planId, period: ctx.periods[CURRENT]!, lineId: food.id, amount: 300 });
    await assign({ planId: ctx.planId, period: ctx.periods[CURRENT]!, lineId: fun.id, amount: 60 });
    return { ...ctx, food, fun };
  };

  it('is null for a plan without a pool', async () => {
    const { planId, periods, addLine } = await setup();
    await addLine({ name: 'Food' });

    expect((await view({ planId, period: periods[CURRENT]! })).coverage).toBeNull();
  });

  it('is nothing_tracked when no line has a goal or an assignment', async () => {
    const { planId, periods, addLine } = await setup({ poolEnabled: true });
    await addLine({ name: 'Food' });

    expect((await view({ planId, period: periods[CURRENT]! })).coverage).toEqual({
      periodId: periods[CURRENT + 1]!.id,
      startDate: periods[CURRENT + 1]!.startDate,
      endDate: periods[CURRENT + 1]!.endDate,
      target: 0,
      linedUp: 700,
      percent: 0,
      left: 0,
      state: 'nothing_tracked',
    });
  });

  it('falls back to the average of the last three assignments, over the periods a line existed', async () => {
    const { planId, periods } = await history();

    expect((await view({ planId, period: periods[CURRENT]! })).coverage).toEqual({
      periodId: periods[CURRENT + 1]!.id,
      startDate: periods[CURRENT + 1]!.startDate,
      endDate: periods[CURRENT + 1]!.endDate,
      target: 260,
      linedUp: 40,
      percent: 15,
      left: 220,
      state: 'left_to_cover',
    });
  });

  it("uses the next period's goal ask with its own carry, and counts money assigned there", async () => {
    const { planId, periods, food } = await history();
    await helpers.setBudgetLineGoal({
      planId,
      lineId: food.id,
      payload: { frequency: 'every_period', behavior: 'refill_up_to', amount: 750 },
      raw: true,
    });
    await assign({ planId, period: periods[CURRENT + 1]!, lineId: food.id, amount: 30 });

    // Food carries 600 in, so refilling to 750 asks 150; Fun keeps its 60 average.
    expect((await view({ planId, period: periods[CURRENT]! })).coverage).toMatchObject({
      target: 210,
      linedUp: 40,
      percent: 19,
      left: 170,
      state: 'left_to_cover',
    });
  });

  it('is prepared when the pool covers the target', async () => {
    const { planId, periods } = await history({ initialBalance: 2000 });

    expect((await view({ planId, period: periods[CURRENT]! })).coverage).toMatchObject({
      target: 260,
      linedUp: 1340,
      percent: 100,
      left: 0,
      state: 'prepared',
    });
  });

  it('is over_committed when the next period assigns more than the pool holds', async () => {
    const { planId, periods, food } = await history();
    await assign({ planId, period: periods[CURRENT + 1]!, lineId: food.id, amount: 500 });

    expect((await view({ planId, period: periods[CURRENT]! })).coverage).toMatchObject({
      linedUp: 500,
      state: 'over_committed',
    });
  });
});
