import { BUDGET_PLAN_TRASH_RETENTION_DAYS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPeriods from '@models/budget-periods.model';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import { budgetPlansPurgeCron } from '@root/crons/budget-plans-purge';
import * as helpers from '@tests/helpers';
import { subDays } from 'date-fns';

/** The purge has no HTTP surface, so this e2e invokes it directly. */

describe('Budget plans purge cron', () => {
  it('hard-deletes a plan past the retention window with all its child rows, and keeps trashed ones inside the window and the active one', async () => {
    const expired = await helpers.createBudgetPlan({ raw: true });
    expect(expired.accountIds).toHaveLength(1);
    const planId = expired.plan.id;
    const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
    const [period] = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });
    await helpers.setBudgetAssignment({
      planId,
      periodId: period!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 100 },
      raw: true,
    });
    expect(await BudgetAssignments.count({ where: { lineId: line.id } })).toBe(1);
    await helpers.deleteBudgetPlan({ planId });

    const fresh = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: fresh.plan.id });

    const insideWindow = await helpers.createBudgetPlan({ raw: true });
    await helpers.deleteBudgetPlan({ planId: insideWindow.plan.id });

    const active = await helpers.createBudgetPlan({ raw: true });

    await BudgetPlans.update(
      { deletedAt: subDays(new Date(), BUDGET_PLAN_TRASH_RETENTION_DAYS + 1) },
      { where: { id: planId }, paranoid: false },
    );
    await BudgetPlans.update(
      { deletedAt: subDays(new Date(), BUDGET_PLAN_TRASH_RETENTION_DAYS - 1) },
      { where: { id: insideWindow.plan.id }, paranoid: false },
    );

    expect(await budgetPlansPurgeCron.triggerManualSync()).toEqual({ purged: 1 });

    expect(await BudgetPlans.findByPk(planId, { paranoid: false })).toBeNull();
    expect(await BudgetPlanAccounts.count({ where: { planId } })).toBe(0);
    expect(await BudgetLines.count({ where: { planId } })).toBe(0);
    expect(await BudgetPeriods.count({ where: { planId } })).toBe(0);
    expect(await BudgetLineCategories.count({ where: { lineId: line.id } })).toBe(0);
    expect(await BudgetAssignments.count({ where: { lineId: line.id } })).toBe(0);
    expect(await BudgetPlans.findByPk(fresh.plan.id, { paranoid: false })).not.toBeNull();
    expect(await BudgetPlans.findByPk(insideWindow.plan.id, { paranoid: false })).not.toBeNull();
    expect(await BudgetPlans.findByPk(active.plan.id)).not.toBeNull();
  });
});
