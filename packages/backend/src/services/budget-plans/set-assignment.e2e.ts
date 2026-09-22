import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetAssignments from '@models/budget-assignments.model';
import * as helpers from '@tests/helpers';

const setup = async ({ monthsAgo = 2 }: { monthsAgo?: number } = {}) => {
  const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
  const { plan } = await helpers.createBudgetPlan({
    payload: { epochDate: helpers.budgetPeriodStart({ monthsAgo }) },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  const line = await helpers.createBudgetPlanLine({
    planId: plan.id,
    payload: { name: 'Food', categoryIds: [food.id], activeFrom: periods[0]!.startDate },
    raw: true,
  });

  return { food, planId: plan.id, periods, line };
};

/** Read-only peek at the sparse rows: no endpoint exposes them. */
const storedRows = ({ lineId }: { lineId: string }) => BudgetAssignments.findAll({ where: { lineId } });

const assignedIn = async ({ planId, periodId }: { planId: string; periodId: string }) => {
  const view = await helpers.getBudgetPlanPeriodView({ planId, periodId, raw: true });
  return view.lines[0]!;
};

describe('Budget plan assignment writes', () => {
  it('sets a baseline for this period and every later one, clearing the override', async () => {
    const { planId, periods, line } = await setup();

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[1]!.id,
      lineId: line.id,
      payload: { scope: 'this_period', amount: 500 },
      raw: true,
    });
    const result = await helpers.setBudgetAssignment({
      planId,
      periodId: periods[1]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 12.34 },
      raw: true,
    });

    expect(result.lines[0]).toMatchObject({ assigned: 12.34, assignedSource: 'baseline' });
    expect(await assignedIn({ planId, periodId: periods[0]!.id })).toMatchObject({
      assigned: 0,
      assignedSource: 'none',
    });
    expect(await assignedIn({ planId, periodId: periods[2]!.id })).toMatchObject({
      assigned: 12.34,
      assignedSource: 'baseline',
    });
  });

  it('changes one period only with this_period', async () => {
    const { planId, periods, line } = await setup();

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 100 },
      raw: true,
    });
    const result = await helpers.setBudgetAssignment({
      planId,
      periodId: periods[1]!.id,
      lineId: line.id,
      payload: { scope: 'this_period', amount: 150 },
      raw: true,
    });

    expect(result.lines[0]).toMatchObject({ assigned: 150, assignedSource: 'override' });
    expect(await assignedIn({ planId, periodId: periods[2]!.id })).toMatchObject({
      assigned: 100,
      assignedSource: 'baseline',
    });
  });

  it('inherits again after a clear, while 0 stops the line', async () => {
    const { planId, periods, line } = await setup();

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 100 },
      raw: true,
    });
    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[1]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 300 },
      raw: true,
    });

    const cleared = await helpers.setBudgetAssignment({
      planId,
      periodId: periods[1]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: null },
      raw: true,
    });
    expect(cleared.lines[0]).toMatchObject({ assigned: 100, assignedSource: 'baseline' });

    const stopped = await helpers.setBudgetAssignment({
      planId,
      periodId: periods[1]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 0 },
      raw: true,
    });
    expect(stopped.lines[0]).toMatchObject({ assigned: 0, assignedSource: 'baseline' });
  });

  it('deletes the row once its last value is cleared', async () => {
    const { planId, periods, line } = await setup();

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'this_period', amount: 100 },
      raw: true,
    });
    expect(await storedRows({ lineId: line.id })).toHaveLength(1);

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'this_period', amount: null },
      raw: true,
    });
    expect(await storedRows({ lineId: line.id })).toHaveLength(0);
  });

  it('carries a rollover setting into this period and later, and clears it back to the plan default', async () => {
    const { planId, periods, line } = await setup();

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 100, carryPolicy: 'floor' },
      raw: true,
    });

    expect(await assignedIn({ planId, periodId: periods[1]!.id })).toMatchObject({
      carryPolicy: 'floor',
      carriedIn: 100,
    });

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', carryPolicy: null },
      raw: true,
    });

    expect(await assignedIn({ planId, periodId: periods[1]!.id })).toMatchObject({
      carryPolicy: 'none',
      carriedIn: 0,
    });
  });

  it('turns on rollover for a period that has no stored row', async () => {
    const { planId, periods, line } = await setup();

    const result = await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', carryPolicy: 'floor' },
      raw: true,
    });

    expect(result.lines[0]).toMatchObject({ assigned: 0, assignedSource: 'none', carryPolicy: 'floor' });
  });

  it('keeps both fields when two concurrent writes touch different ones', async () => {
    const { planId, periods, line } = await setup();

    await Promise.all([
      helpers.setBudgetAssignment({
        planId,
        periodId: periods[1]!.id,
        lineId: line.id,
        payload: { scope: 'this_period', amount: 250 },
        raw: true,
      }),
      helpers.setBudgetAssignment({
        planId,
        periodId: periods[1]!.id,
        lineId: line.id,
        payload: { scope: 'this_period', carryPolicy: 'signed' },
        raw: true,
      }),
    ]);

    expect(await assignedIn({ planId, periodId: periods[1]!.id })).toMatchObject({
      assigned: 250,
      assignedSource: 'override',
      carryPolicy: 'signed',
    });
  });
});

describe('Budget plan assignment guards', () => {
  it('rejects a negative amount and an empty body', async () => {
    const { planId, periods, line } = await setup();
    const target = { planId, periodId: periods[0]!.id, lineId: line.id };

    expect(
      (await helpers.setBudgetAssignment({ ...target, payload: { scope: 'from_here', amount: -1 } })).statusCode,
    ).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.setBudgetAssignment({ ...target, payload: { scope: 'from_here' } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
  });

  it('404s on an unknown period, an unknown line, and a period of another plan', async () => {
    const { planId, periods, line } = await setup();
    const payload = { scope: 'from_here' as const, amount: 10 };

    expect(
      (
        await helpers.setBudgetAssignment({
          planId,
          periodId: generateRandomRecordId(),
          lineId: line.id,
          payload,
        })
      ).statusCode,
    ).toBe(ERROR_CODES.NotFoundError);
    expect(
      (
        await helpers.setBudgetAssignment({
          planId,
          periodId: periods[0]!.id,
          lineId: generateRandomRecordId(),
          payload,
        })
      ).statusCode,
    ).toBe(ERROR_CODES.NotFoundError);

    await helpers.deleteBudgetPlan({ planId });
    const { plan: second } = await helpers.createBudgetPlan({ raw: true });
    const secondLine = await helpers.createBudgetPlanLine({
      planId: second.id,
      payload: { name: 'Food', categoryIds: [(await helpers.getCategoriesList())[0]!.id] },
      raw: true,
    });

    expect(
      (
        await helpers.setBudgetAssignment({
          planId: second.id,
          periodId: periods[0]!.id,
          lineId: secondLine.id,
          payload,
        })
      ).statusCode,
    ).toBe(ERROR_CODES.NotFoundError);
  });

  it('409s on a period outside the line lifetime', async () => {
    const { planId, periods } = await setup();
    const transport = await helpers.addCustomCategory({ name: 'Transport', color: '#222222', raw: true });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Later', categoryIds: [transport.id], activeFrom: periods[2]!.startDate },
      raw: true,
    });

    expect(
      (
        await helpers.setBudgetAssignment({
          planId,
          periodId: periods[0]!.id,
          lineId: line.id,
          payload: { scope: 'from_here', amount: 10 },
        })
      ).statusCode,
    ).toBe(ERROR_CODES.ConflictError);
  });

  it('deletes the current row when the line is archived', async () => {
    const { planId, periods, line } = await setup();

    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 100 },
      raw: true,
    });
    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[2]!.id,
      lineId: line.id,
      payload: { scope: 'this_period', amount: 400 },
      raw: true,
    });

    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    expect((await storedRows({ lineId: line.id })).map((row) => row.periodId)).toEqual([periods[0]!.id]);
    expect((await helpers.getBudgetPlanPeriodView({ planId, periodId: periods[2]!.id, raw: true })).lines).toEqual([]);
    expect(
      (await helpers.getBudgetPlanPeriodView({ planId, periodId: periods[1]!.id, raw: true })).lines[0],
    ).toMatchObject({ assigned: 100 });
  });
});
