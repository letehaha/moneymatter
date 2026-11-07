import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { deleteGroup } from '@services/budget-plans/line-groups';

import { defineTool } from '../define-tool';

export const deleteBudgetPlanGroupTool = defineTool({
  name: 'delete_budget_plan_group',
  toolset: 'budget-plans',
  access: 'delete',
  feature: FEATURES.budget_plan,
  description:
    'Delete a group of a budget plan. A group that still holds active lines cannot be deleted: move or archive the lines first. Archived lines left in it become ungrouped. This action is irreversible: confirm with the user before calling. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    groupId: recordId().describe('ID of the group to delete (from get_budget_plan_period, in its groups)'),
  },
  run: async ({ userId, args }) => {
    await deleteGroup({ userId, planId: args.planId, groupId: args.groupId });

    return { deleted: true, id: args.groupId, planId: args.planId };
  },
});
