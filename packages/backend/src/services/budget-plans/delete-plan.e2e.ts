import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetLines from '@models/budget-lines.model';
import * as helpers from '@tests/helpers';

describe('Budget plan permanent delete', () => {
  it('removes a trashed plan with its lines and leaves the other trashed plan restorable', async () => {
    const doomed = await helpers.createBudgetPlan({ raw: true });
    const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
    await helpers.createBudgetPlanLine({
      planId: doomed.plan.id,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });
    await helpers.deleteBudgetPlan({ planId: doomed.plan.id });

    const kept = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: kept.plan.id });

    const response = await helpers.deleteBudgetPlan({ planId: doomed.plan.id, permanent: true });
    expect(response.statusCode).toBe(200);

    const trashed = await helpers.listBudgetPlans({ includeDeleted: true, raw: true });
    expect(trashed.map((plan) => plan.id)).toEqual([kept.plan.id]);
    expect(await BudgetLines.count({ where: { planId: doomed.plan.id } })).toBe(0);
    expect((await helpers.restoreBudgetPlan({ planId: doomed.plan.id })).statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('refuses an active plan and keeps it', async () => {
    const active = await helpers.createBudgetPlan({ raw: true });

    const response = await helpers.deleteBudgetPlan({ planId: active.plan.id, permanent: true });
    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);

    const plans = await helpers.listBudgetPlans({ raw: true });
    expect(plans.map((plan) => plan.id)).toEqual([active.plan.id]);
  });

  it("answers 404 for another user's trashed plan and leaves it restorable", async () => {
    const created = await helpers.createBudgetPlan({ raw: true });
    const planId = created.plan.id;
    await helpers.deleteBudgetPlan({ planId });
    const other = await helpers.provisionSecondUserWithBaseCurrency();

    const response = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.deleteBudgetPlan({ planId, permanent: true }),
    });
    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);

    const trashed = await helpers.listBudgetPlans({ includeDeleted: true, raw: true });
    expect(trashed.map((plan) => plan.id)).toEqual([planId]);
    expect((await helpers.restoreBudgetPlan({ planId })).statusCode).toBe(200);
  });

  it('answers 404 for an unknown plan', async () => {
    const response = await helpers.deleteBudgetPlan({ planId: generateRandomRecordId(), permanent: true });
    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});
