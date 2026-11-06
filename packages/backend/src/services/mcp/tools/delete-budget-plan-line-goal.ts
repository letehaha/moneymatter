import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { deleteLineGoal } from '@services/budget-plans/line-goals';

import { defineTool } from '../define-tool';

export const deleteBudgetPlanLineGoalTool = defineTool({
  name: 'delete_budget_plan_line_goal',
  toolset: 'budget-plans',
  access: 'delete',
  feature: FEATURES.budget_plan,
  description:
    'Delete the goal of a budget plan line. The line and its assignments stay; only the goal is removed, and the snooze with it. Fails if the line has no goal. This action is irreversible: confirm with the user before calling. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    lineId: recordId().describe('ID of the line whose goal to delete (from get_budget_plan_period)'),
  },
  run: async ({ userId, args }) => {
    await deleteLineGoal({ userId, planId: args.planId, lineId: args.lineId });

    return { deleted: true, lineId: args.lineId, planId: args.planId };
  },
});
