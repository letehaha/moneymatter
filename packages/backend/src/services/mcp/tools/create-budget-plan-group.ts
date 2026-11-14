import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createGroup } from '@services/budget-plans/line-groups';
import { createGroupBodyFields, createGroupBodySchema } from '@services/budget-plans/zod-schemas';

import { defineTool } from '../define-tool';

export const createBudgetPlanGroupTool = defineTool({
  name: 'create_budget_plan_group',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    'Add a group to a budget plan: a named section that lines sit in, shown after the existing groups. Returns { id, name, sortOrder }. Put lines into it with the line tools. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    name: createGroupBodyFields.name.describe('Name of the group, 1 to 200 characters, e.g. "Fixed costs"'),
  },
  validate: ({ args }) => {
    const { name } = createGroupBodySchema.parse({ name: args.name });
    return { planId: args.planId, name };
  },
  run: ({ userId, args: { planId, name } }) => createGroup({ userId, planId, name }),
});
