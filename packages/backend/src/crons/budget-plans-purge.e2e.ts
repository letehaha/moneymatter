import { describe, expect, it } from '@jest/globals';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import { BUDGET_PLAN_TRASH_RETENTION_DAYS, budgetPlansPurgeCron } from '@root/crons/budget-plans-purge';
import * as helpers from '@tests/helpers';
import { subDays } from 'date-fns';

/** The purge has no HTTP surface, so this e2e invokes it directly. */

describe('Budget plans purge cron', () => {
  it('hard-deletes a plan past the retention window with its join rows, and keeps a fresh one', async () => {
    const expired = await helpers.createBudgetPlan({ raw: true });
    expect(expired.accountIds).toHaveLength(1);
    await helpers.deleteBudgetPlan({ planId: expired.plan.id });

    const fresh = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: fresh.plan.id });

    await BudgetPlans.update(
      { deletedAt: subDays(new Date(), BUDGET_PLAN_TRASH_RETENTION_DAYS + 1) },
      { where: { id: expired.plan.id }, paranoid: false },
    );

    expect(await budgetPlansPurgeCron.triggerManualCheck()).toBe(1);

    expect(await BudgetPlans.findByPk(expired.plan.id, { paranoid: false })).toBeNull();
    expect(await BudgetPlanAccounts.count({ where: { planId: expired.plan.id } })).toBe(0);
    expect(await BudgetPlans.findByPk(fresh.plan.id, { paranoid: false })).not.toBeNull();
  });
});
