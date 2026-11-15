import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { setAssignment } from '@services/budget-plans/set-assignment';
import { setAssignmentBodyFields, setAssignmentBodySchema } from '@services/budget-plans/zod-schemas';

import { defineTool } from '../define-tool';

export const setBudgetPlanAssignmentTool = defineTool({
  name: 'set_budget_plan_assignment',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    'Assign money to a budget plan line in a period, or change its carry policy there. Required: planId, periodId, lineId (from get_budget_plan_period) and scope (from_here: the amount becomes the baseline from this period on; this_period: the amount is a one-period override); send amount, carryPolicy or both, since an empty change is refused. null clears a field and an omitted field is left untouched. The period must be one the line is active in. Returns the updated period view, as get_budget_plan_period does. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    periodId: recordId().describe('Period to assign in (from get_budget_plan_period)'),
    lineId: recordId().describe('Line to assign to (from get_budget_plan_period)'),
    scope: setAssignmentBodyFields.scope.describe(
      'from_here: the amount becomes the baseline from this period on and clears this period override. this_period: the amount is an override for this one period only. It only affects amount',
    ),
    amount: setAssignmentBodyFields.amount.describe(
      'Amount to assign in the plan currency, 0 or more, as many decimal places as the plan currency has. null clears it for the scope (the baseline for from_here, the override for this_period). Omit to leave it unchanged',
    ),
    carryPolicy: setAssignmentBodyFields.carryPolicy.describe(
      'How an unspent or overspent balance carries into the next period: floor, signed or none, for this line and period. null clears it back to the plan default. Omit to leave it unchanged',
    ),
  },
  validate: ({ args }) => {
    const { planId, periodId, lineId, ...body } = args;
    return { planId, periodId, lineId, ...setAssignmentBodySchema.parse(body) };
  },
  run: async ({ userId, args }) => setAssignment({ userId, ...args }),
});
