import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { setPlanAccounts } from '@services/budget-plans/set-plan-accounts';
import { setPlanAccountsBodyFields, setPlanAccountsBodySchema } from '@services/budget-plans/zod-schemas';

import { defineTool } from '../define-tool';
import { presentBudgetPlanDetails } from './budget-plan-output';

export const setBudgetPlanAccountsTool = defineTool({
  name: 'set_budget_plan_accounts',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    'Replace the set of accounts a budget plan counts activity from. Send the full list: accounts left out are detached, new ones are attached. Returns the plan with its accountIds and lines. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    accountIds: setPlanAccountsBodyFields.accountIds.describe(
      'The full list of accounts the plan counts activity from (from get_accounts): unique ids, your own accounts of categories a plan can attach. An empty list detaches every account',
    ),
  },
  validate: ({ args }) => {
    const { accountIds } = setPlanAccountsBodySchema.parse({ accountIds: args.accountIds });
    return { planId: args.planId, accountIds };
  },
  run: async ({ userId, args: { planId, accountIds } }) => {
    const details = await setPlanAccounts({ userId, planId, accountIds });

    return presentBudgetPlanDetails({ details });
  },
});
