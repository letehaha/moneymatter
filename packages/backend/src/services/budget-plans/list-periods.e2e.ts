import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { toUtcDateString } from '@common/utils/date';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetPeriods from '@models/budget-periods.model';
import * as helpers from '@tests/helpers';

describe('Budget plan periods', () => {
  it('lists one current period for a fresh plan', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });

    const periods = await helpers.listBudgetPlanPeriods({ planId: created.plan.id, raw: true });

    expect(periods).toEqual([
      {
        id: expect.any(String),
        startDate: helpers.budgetPeriodStart(),
        endDate: helpers.budgetPeriodStart({ monthsAgo: -1 }),
        isCurrent: true,
      },
    ]);
  });

  it('fills every period from a backdated epoch up to today', async () => {
    const created = await helpers.createBudgetPlan({
      payload: { epochDate: helpers.budgetPeriodStart({ monthsAgo: 3 }) },
      raw: true,
    });

    const periods = await helpers.listBudgetPlanPeriods({ planId: created.plan.id, raw: true });

    expect(periods).toHaveLength(4);
    expect(periods[0]!.startDate).toBe(helpers.budgetPeriodStart({ monthsAgo: 3 }));
    expect(periods[3]!.startDate).toBe(helpers.budgetPeriodStart());
    expect(periods.map((period) => period.isCurrent)).toEqual([false, false, false, true]);
  });

  it('creates the period that starts on the requested boundary day', async () => {
    const today = toUtcDateString(new Date());
    const created = await helpers.createBudgetPlan({
      payload: { cadence: 'days', intervalN: 1, anchorDate: today },
      raw: true,
    });

    const periods = await helpers.listBudgetPlanPeriods({ planId: created.plan.id, raw: true });

    expect(periods).toHaveLength(1);
    expect(periods[0]!.startDate).toBe(today);
    expect(periods[0]!.isCurrent).toBe(true);
  });

  it('survives two concurrent listings with one row per period', async () => {
    const created = await helpers.createBudgetPlan({
      payload: { epochDate: helpers.budgetPeriodStart({ monthsAgo: 2 }) },
      raw: true,
    });

    const [first, second] = await Promise.all([
      helpers.listBudgetPlanPeriods({ planId: created.plan.id }),
      helpers.listBudgetPlanPeriods({ planId: created.plan.id }),
    ]);

    const stored = await BudgetPeriods.findAll({
      where: { planId: created.plan.id },
      order: [['startDate', 'ASC']],
    });
    const storedIds = stored.map((period) => period.id);

    expect(storedIds).toHaveLength(3);
    for (const response of [first!, second!]) {
      expect(response.statusCode).toBe(200);
      expect(helpers.extractResponse(response).map((period) => period.id)).toEqual(storedIds);
    }
  });

  it('404s on an unknown plan and on a plan owned by someone else', async () => {
    const created = await helpers.createBudgetPlan({ raw: true });
    const other = await helpers.provisionSecondUserWithBaseCurrency();

    expect((await helpers.listBudgetPlanPeriods({ planId: generateRandomRecordId() })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );

    const foreign = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.listBudgetPlanPeriods({ planId: created.plan.id }),
    });
    expect(foreign.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});
