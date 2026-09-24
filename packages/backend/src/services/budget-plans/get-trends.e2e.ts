import { TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const setup = async () => {
  const account = await helpers.createAccount({ raw: true });
  const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });

  const { plan } = await helpers.createBudgetPlan({
    payload: { accountIds: [account.id], epochDate: helpers.budgetPeriodStart({ monthsAgo: 3 }) },
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
    payload: { scope: 'from_here', amount: 100 },
    raw: true,
  });
  await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: food.id,
        amount: 130,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      time: `${periods[1]!.startDate}T12:00:00.000Z`,
    },
    raw: true,
  });

  const current = periods.findIndex((period) => period.isCurrent);
  return { planId: plan.id, periods, line, current };
};

describe('GET /budget-plans/:planId/trends', () => {
  it('returns the periods through the current one, clipped at the first, matching the period view', async () => {
    const { planId, periods, line, current } = await setup();

    const { periods: trend } = await helpers.getBudgetPlanTrends({ planId, raw: true });

    expect(trend.map((entry) => entry.periodId)).toEqual(periods.slice(0, current + 1).map((period) => period.id));
    expect(trend[1]!.activity).toBe(-130);
    expect(trend[1]!.lines[0]!.lineId).toBe(line.id);

    for (const entry of trend) {
      const view = await helpers.getBudgetPlanPeriodView({ planId, periodId: entry.periodId, raw: true });

      expect(entry).toEqual({
        periodId: view.period.id,
        startDate: view.period.startDate,
        endDate: view.period.endDate,
        assigned: view.header.totalAssigned,
        activity: view.header.totalActivity,
        carriedIn: view.header.totalCarriedIn,
        available: view.header.totalAvailable,
        lines: view.lines.map(({ lineId, assigned, activity, available }) => ({
          lineId,
          assigned,
          activity,
          available,
        })),
      });
    }
  });

  it('ends at `until` and returns `count` periods, oldest first', async () => {
    const { planId, periods, current } = await setup();

    const { periods: trend } = await helpers.getBudgetPlanTrends({
      planId,
      until: periods[current + 2]!.id,
      count: 2,
      raw: true,
    });

    expect(trend.map((entry) => entry.periodId)).toEqual([periods[current + 1]!.id, periods[current + 2]!.id]);
  });

  it('returns zeroed periods with no lines for a plan without lines', async () => {
    const { plan } = await helpers.createBudgetPlan({ raw: true });

    const { periods: trend } = await helpers.getBudgetPlanTrends({ planId: plan.id, raw: true });

    expect(trend.length).toBeGreaterThan(0);
    for (const entry of trend) {
      expect(entry).toMatchObject({ assigned: 0, activity: 0, carriedIn: 0, available: 0, lines: [] });
    }
  });

  it('rejects an unknown plan, an unknown `until`, and a `count` out of range', async () => {
    const { planId } = await setup();

    const unknownPlan = await helpers.getBudgetPlanTrends({ planId: generateRandomRecordId() });
    expect(unknownPlan.statusCode).toBe(ERROR_CODES.NotFoundError);

    const unknownUntil = await helpers.getBudgetPlanTrends({ planId, until: generateRandomRecordId() });
    expect(unknownUntil.statusCode).toBe(ERROR_CODES.NotFoundError);

    for (const count of [0, 25, 'abc']) {
      const response = await helpers.getBudgetPlanTrends({ planId, count });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }
  });
});
