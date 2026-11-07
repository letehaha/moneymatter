import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { updatePlan } from '@services/budget-plans/update-plan';
import { updatePlanBodyFields, updatePlanBodySchema } from '@services/budget-plans/zod-schemas';

import { defineTool } from '../define-tool';
import { presentBudgetPlanDetails } from './budget-plan-output';

export const updateBudgetPlanTool = defineTool({
  name: 'update_budget_plan',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    'Change the settings of a budget plan. Send only the fields to change: name, autoAttachAccounts, carryPolicy, poolEnabled, zeroSum, expectedIncome (null clears it). The cadence, anchor date, epoch and type are fixed when the plan is created and cannot be changed. To change the accounts use set_budget_plan_accounts. Returns the plan with its accountIds and lines. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    name: updatePlanBodyFields.name.describe('New name, 1 to 200 characters'),
    autoAttachAccounts: updatePlanBodyFields.autoAttachAccounts.describe(
      'Attach accounts you create later to the plan automatically',
    ),
    carryPolicy: updatePlanBodyFields.carryPolicy.describe(
      'What carries from a period to the next: "floor", "signed" or "none". It applies to every period and line without a setting of its own, past ones included',
    ),
    poolEnabled: updatePlanBodyFields.poolEnabled.describe(
      'true: fund the plan from a pool, starting at the current period. false: stop using the pool (this also turns zeroSum off)',
    ),
    zeroSum: updatePlanBodyFields.zeroSum.describe(
      'Require every unit of income in the pool to be assigned. Needs the pool to be on',
    ),
    expectedIncome: updatePlanBodyFields.expectedIncome.describe(
      'Income expected per period, a non-negative decimal in the plan currency; null clears it',
    ),
  },
  run: async ({ userId, args }) => {
    const { planId, ...patch } = args;
    const details = await updatePlan({ userId, planId, ...updatePlanBodySchema.parse(patch) });

    return presentBudgetPlanDetails({ details });
  },
});
