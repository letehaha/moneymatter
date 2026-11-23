import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const setup = async () => {
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
    raw: true,
  });
  const [food, fun] = await Promise.all([
    helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true }),
    helpers.addCustomCategory({ name: 'Fun', color: '#222222', raw: true }),
  ]);
  const { plan } = await helpers.createBudgetPlan({
    payload: { accountIds: [account.id], epochDate: helpers.budgetPeriodStart({ monthsAgo: 2 }), poolEnabled: true },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  const [foodLine, funLine] = await Promise.all([
    helpers.createBudgetPlanLine({
      planId: plan.id,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: periods[0]!.startDate },
      raw: true,
    }),
    helpers.createBudgetPlanLine({
      planId: plan.id,
      payload: { name: 'Fun', categoryIds: [fun.id], activeFrom: periods[0]!.startDate },
      raw: true,
    }),
  ]);

  return { planId: plan.id, periodId: periods[2]!.id, periods, foodLine, funLine };
};

const lineOf = ({ view, lineId }: { view: { lines: { lineId: string }[] }; lineId: string }) =>
  view.lines.find((line) => line.lineId === lineId);

describe('Budget plan multi-line assignment', () => {
  it('sets this-period overrides on several lines and lowers Ready to Assign by their sum', async () => {
    const { planId, periodId, foodLine, funLine } = await setup();
    const before = await helpers.getBudgetPlanPeriodView({ planId, periodId, raw: true });

    const view = await helpers.setBudgetAssignments({
      planId,
      periodId,
      payload: {
        assignments: [
          { lineId: foodLine.id, amount: 100 },
          { lineId: funLine.id, amount: 50.5 },
        ],
      },
      raw: true,
    });

    expect(lineOf({ view, lineId: foodLine.id })).toMatchObject({ assigned: 100, assignedSource: 'override' });
    expect(lineOf({ view, lineId: funLine.id })).toMatchObject({ assigned: 50.5, assignedSource: 'override' });
    expect(view.pool!.readyToAssign).toBeCloseTo(before.pool!.readyToAssign - 150.5, 2);
  });

  it('clears an override with null, falling back to the baseline', async () => {
    const { planId, periodId, periods, foodLine } = await setup();
    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: foodLine.id,
      payload: { scope: 'from_here', amount: 80 },
      raw: true,
    });
    await helpers.setBudgetAssignments({
      planId,
      periodId,
      payload: { assignments: [{ lineId: foodLine.id, amount: 200 }] },
      raw: true,
    });

    const view = await helpers.setBudgetAssignments({
      planId,
      periodId,
      payload: { assignments: [{ lineId: foodLine.id, amount: null }] },
      raw: true,
    });

    expect(lineOf({ view, lineId: foodLine.id })).toMatchObject({ assigned: 80, assignedSource: 'baseline' });
  });

  it('keeps a zero override over a baseline, so taking everything back sticks', async () => {
    const { planId, periodId, periods, foodLine } = await setup();
    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: foodLine.id,
      payload: { scope: 'from_here', amount: 80 },
      raw: true,
    });
    const before = await helpers.getBudgetPlanPeriodView({ planId, periodId, raw: true });

    const view = await helpers.setBudgetAssignments({
      planId,
      periodId,
      payload: { assignments: [{ lineId: foodLine.id, amount: 0 }] },
      raw: true,
    });

    expect(lineOf({ view, lineId: foodLine.id })).toMatchObject({ assigned: 0, assignedSource: 'override' });
    expect(view.pool!.readyToAssign).toBeCloseTo(before.pool!.readyToAssign + 80, 2);
  });

  it('treats null on a line without an assignment as a no-op', async () => {
    const { planId, periodId, foodLine } = await setup();

    const view = await helpers.setBudgetAssignments({
      planId,
      periodId,
      payload: { assignments: [{ lineId: foodLine.id, amount: null }] },
      raw: true,
    });

    expect(lineOf({ view, lineId: foodLine.id })).toMatchObject({ assigned: 0, assignedSource: 'none' });
  });

  it('saves nothing when one line fails', async () => {
    const { planId, periods, foodLine } = await setup();
    const later = await helpers.createBudgetPlanLine({
      planId,
      payload: {
        name: 'Later',
        categoryIds: [(await helpers.addCustomCategory({ name: 'Later', color: '#333333', raw: true })).id],
        activeFrom: periods[2]!.startDate,
      },
      raw: true,
    });

    const res = await helpers.setBudgetAssignments({
      planId,
      periodId: periods[0]!.id,
      payload: {
        assignments: [
          { lineId: foodLine.id, amount: 100 },
          { lineId: later.id, amount: 10 },
        ],
      },
    });

    expect(res.statusCode).toBe(ERROR_CODES.ConflictError);
    const view = await helpers.getBudgetPlanPeriodView({ planId, periodId: periods[0]!.id, raw: true });
    expect(lineOf({ view, lineId: foodLine.id })).toMatchObject({ assigned: 0, assignedSource: 'none' });
  });
});

describe('Budget plan multi-line assignment guards', () => {
  it('rejects an empty list, a repeated line, and a negative amount', async () => {
    const { planId, periodId, foodLine } = await setup();
    const send = ({ assignments }: { assignments: { lineId: string; amount: number | null }[] }) =>
      helpers.setBudgetAssignments({ planId, periodId, payload: { assignments } });

    expect((await send({ assignments: [] })).statusCode).toBe(ERROR_CODES.ValidationError);
    expect(
      (
        await send({
          assignments: [
            { lineId: foodLine.id, amount: 1 },
            { lineId: foodLine.id, amount: 2 },
          ],
        })
      ).statusCode,
    ).toBe(ERROR_CODES.ValidationError);
    expect((await send({ assignments: [{ lineId: foodLine.id, amount: -1 }] })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
  });

  it('404s on an unknown line', async () => {
    const { planId, periodId } = await setup();

    const res = await helpers.setBudgetAssignments({
      planId,
      periodId,
      payload: { assignments: [{ lineId: generateRandomRecordId(), amount: 10 }] },
    });

    expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('404s on an unknown period', async () => {
    const { planId, foodLine } = await setup();

    const res = await helpers.setBudgetAssignments({
      planId,
      periodId: generateRandomRecordId(),
      payload: { assignments: [{ lineId: foodLine.id, amount: 10 }] },
    });

    expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});
