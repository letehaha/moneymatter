import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { deleteLine } from '@services/budget-plans/delete-line';

import { defineTool } from '../define-tool';

export const deleteBudgetPlanLineTool = defineTool({
  name: 'delete_budget_plan_line',
  toolset: 'budget-plans',
  access: 'delete',
  feature: FEATURES.budget_plan,
  description:
    'Permanently delete a line of a budget plan with all its category memberships and assignments in every period, so its categories become unbudgeted. To stop budgeting a line but keep its history use archive_budget_plan_line instead. This action is irreversible: confirm with the user before calling. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    lineId: recordId().describe('ID of the line to delete (from get_budget_plan_period)'),
  },
  run: async ({ userId, args }) => {
    await deleteLine({ userId, planId: args.planId, lineId: args.lineId });

    return { deleted: true, id: args.lineId, planId: args.planId };
  },
});
