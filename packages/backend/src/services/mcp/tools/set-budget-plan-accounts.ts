import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setPlanAccounts } from '@services/budget-plans/set-plan-accounts';
import { setPlanAccountsBodyFields, setPlanAccountsBodySchema } from '@services/budget-plans/zod-schemas';

import { presentBudgetPlanDetails } from './budget-plan-output';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  accountIds: setPlanAccountsBodyFields.accountIds.describe(
    'The full list of accounts the plan counts activity from (from get_accounts): unique ids, your own accounts of categories a plan can attach. An empty list detaches every account',
  ),
};

export function registerSetBudgetPlanAccounts(server: McpServer) {
  server.registerTool(
    'set_budget_plan_accounts',
    {
      description:
        'Replace the set of accounts a budget plan counts activity from. Send the full list: accounts left out are detached, new ones are attached. Returns the plan with its accountIds and lines. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await requireFeature({ userId, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'set_budget_plan_accounts', clientId: extra.authInfo?.clientId });

      const { accountIds } = setPlanAccountsBodySchema.parse({ accountIds: args.accountIds });
      const details = await setPlanAccounts({ userId, planId: args.planId, accountIds });

      return jsonContent({ data: presentBudgetPlanDetails({ details }) });
    },
  );
}
