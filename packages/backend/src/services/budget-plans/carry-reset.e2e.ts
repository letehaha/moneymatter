import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

type Period = { id: string };

const setup = async ({ poolEnabled = false }: { poolEnabled?: boolean } = {}) => {
  const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
  const { plan } = await helpers.createBudgetPlan({
    payload: { epochDate: helpers.budgetPeriodStart({ monthsAgo: 2 }), carryPolicy: 'floor', poolEnabled },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  const line = await helpers.createBudgetPlanLine({
    planId: plan.id,
    payload: { name: 'Food', categoryIds: [food.id], activeFrom: periods[0]!.startDate },
    raw: true,
  });
  await helpers.setBudgetAssignment({
    planId: plan.id,
    periodId: periods[0]!.id,
    lineId: line.id,
    payload: { scope: 'this_period', amount: 100 },
    raw: true,
  });

  return { planId: plan.id, periods, line };
};

const setReset = ({ planId, period, reset }: { planId: string; period: Period; reset: boolean }) =>
  helpers.setBudgetPeriodCarryReset({ planId, periodId: period.id, payload: { reset }, raw: true });

const viewAt = ({ planId, period }: { planId: string; period: Period }) =>
  helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true });

describe('PUT /budget-plans/:planId/periods/:periodId/carry-reset', () => {
  it('starts every line of the period with nothing carried in and returns the view', async () => {
    const { planId, periods, line } = await setup();
    expect((await viewAt({ planId, period: periods[1]! })).lines[0]).toMatchObject({ carriedIn: 100, available: 100 });

    const view = await setReset({ planId, period: periods[1]!, reset: true });

    expect(view.period).toMatchObject({ id: periods[1]!.id, carryReset: true });
    expect(view.lines.find((entry) => entry.lineId === line.id)).toMatchObject({ carriedIn: 0, available: 0 });
    expect((await viewAt({ planId, period: periods[2]! })).lines[0]!.carriedIn).toBe(0);
    expect((await viewAt({ planId, period: periods[0]! })).period.carryReset).toBe(false);
  });

  it('restores the carry on undo', async () => {
    const { planId, periods } = await setup();
    await setReset({ planId, period: periods[1]!, reset: true });

    const view = await setReset({ planId, period: periods[1]!, reset: false });

    expect(view.period.carryReset).toBe(false);
    expect(view.lines[0]).toMatchObject({ carriedIn: 100, available: 100 });
  });

  it('defaults to off and resets a plan without lines', async () => {
    const { plan } = await helpers.createBudgetPlan({ raw: true });
    const [period] = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });

    expect((await viewAt({ planId: plan.id, period: period! })).period.carryReset).toBe(false);

    const view = await setReset({ planId: plan.id, period: period!, reset: true });
    expect(view.period.carryReset).toBe(true);
    expect(view.lines).toEqual([]);
    expect(view.header.totalCarriedIn).toBe(0);
  });

  it('returns the wiped surplus to Ready to Assign', async () => {
    const { planId, periods } = await setup({ poolEnabled: true });
    expect((await viewAt({ planId, period: periods[1]! })).pool!.flow.fromLines).toBe(0);

    const view = await setReset({ planId, period: periods[1]!, reset: true });
    expect(view.pool!.flow.fromLines).toBe(100);
  });

  it('answers 404 for a period of another plan or an unknown period', async () => {
    const { plan: other } = await helpers.createBudgetPlan({ raw: true });
    const [otherPeriod] = await helpers.listBudgetPlanPeriods({ planId: other.id, raw: true });
    await helpers.deleteBudgetPlan({ planId: other.id });
    const { planId } = await setup();

    for (const periodId of [otherPeriod!.id, generateRandomRecordId()]) {
      const res = await helpers.setBudgetPeriodCarryReset({ planId, periodId, payload: { reset: true } });
      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    }
  });

  it("answers 404 when another user resets the owner's period", async () => {
    const { planId, periods } = await setup();
    const other = await helpers.provisionSecondUserWithBaseCurrency();

    const res = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.setBudgetPeriodCarryReset({ planId, periodId: periods[1]!.id, payload: { reset: true } }),
    });

    expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect((await viewAt({ planId, period: periods[1]! })).period.carryReset).toBe(false);
  });

  it('rejects an invalid body', async () => {
    const { planId, periods } = await setup();

    for (const payload of [{}, { reset: 'yes' }, { reset: true, extra: 1 }]) {
      const res = await helpers.setBudgetPeriodCarryReset({ planId, periodId: periods[1]!.id, payload });
      expect({ payload, statusCode: res.statusCode }).toEqual({ payload, statusCode: ERROR_CODES.ValidationError });
    }
  });
});
