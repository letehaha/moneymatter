import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { updateGroup } from '@services/budget-plans/line-groups';
import { updateGroupBodyFields, updateGroupBodySchema } from '@services/budget-plans/zod-schemas';

import { defineTool } from '../define-tool';

export const updateBudgetPlanGroupTool = defineTool({
  name: 'update_budget_plan_group',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    'Rename a group of a budget plan. Returns { id, name, sortOrder }. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    groupId: recordId().describe('ID of the group to rename (from get_budget_plan_period, in its groups)'),
    name: updateGroupBodyFields.name.describe('New name, 1 to 200 characters'),
  },
  validate: ({ args }) => {
    const { name } = updateGroupBodySchema.parse({ name: args.name });
    return { planId: args.planId, groupId: args.groupId, name };
  },
  run: ({ userId, args: { planId, groupId, name } }) => updateGroup({ userId, planId, groupId, name }),
});
