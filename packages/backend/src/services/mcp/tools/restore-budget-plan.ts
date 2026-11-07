import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { restorePlan } from '@services/budget-plans/restore-plan';
import { restorePlanBodyFields, restorePlanBodySchema } from '@services/budget-plans/zod-schemas';

import { defineTool } from '../define-tool';
import { presentBudgetPlanDetails } from './budget-plan-output';

export const restoreBudgetPlanTool = defineTool({
  name: 'restore_budget_plan',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    'Bring a budget plan back from the trash. Only one plan can be active: while another one is, the restore fails unless replace is true, which moves the active plan to the trash. A plan made in another base currency than the current one cannot be restored. Returns the plan with its accountIds and lines. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('ID of a plan in the trash (from list_budget_plans with includeDeleted)'),
    replace: restorePlanBodyFields.replace.describe(
      'true: if another plan is active, move it to the trash and restore this one in its place. Default false: restoring fails while another plan is active',
    ),
  },
  validate: ({ args }) => {
    const body = restorePlanBodySchema.parse({ replace: args.replace });
    return { planId: args.planId, replace: body?.replace };
  },
  run: async ({ userId, args: { planId, replace } }) => {
    const details = await restorePlan({ userId, planId, replace });

    return presentBudgetPlanDetails({ details });
  },
});
