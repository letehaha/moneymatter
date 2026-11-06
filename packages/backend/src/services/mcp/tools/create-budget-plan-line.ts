import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createLine } from '@services/budget-plans/create-line';
import { createLineBodyFields, createLineBodySchema } from '@services/budget-plans/zod-schemas';

import { defineTool } from '../define-tool';

export const createBudgetPlanLineTool = defineTool({
  name: 'create_budget_plan_line',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    'Add a line (an envelope for one or more categories) to a budget plan. Required: planId (from list_budget_plans), name, categoryIds (at least one). Optional: sortOrder, groupId, activeFrom. Nothing else is accepted: the end of a line is set with archive_budget_plan_line, not here. Assign money to the new line with set_budget_plan_assignment. Returns the line { id, name, sortOrder, groupId, activeFrom, activeUntil, categoryIds }. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    name: createLineBodyFields.name.describe('Name of the line, 1 to 200 characters, e.g. "Groceries"'),
    categoryIds: createLineBodyFields.categoryIds.describe(
      'Categories whose spending the line tracks (from get_categories), at least one. A category can belong to one line at a time, ancestors and descendants included',
    ),
    sortOrder: createLineBodyFields.sortOrder.describe(
      'Position among the lines of its group (an integer). Default: last in the group',
    ),
    groupId: createLineBodyFields.groupId.describe(
      'Group to put the line in (from get_budget_plan_period, in its groups, or create_budget_plan_group); null or omitted: ungrouped',
    ),
    activeFrom: createLineBodyFields.activeFrom.describe(
      'Period start (YYYY-MM-DD) the line starts in; it must be the start of an existing period up to the current one. Default: the current period',
    ),
  },
  run: ({ userId, args }) => {
    const { planId, ...body } = args;
    return createLine({ userId, planId, ...createLineBodySchema.parse(body) });
  },
});
