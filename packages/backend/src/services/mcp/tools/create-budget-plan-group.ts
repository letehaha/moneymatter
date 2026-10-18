import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGroup } from '@services/budget-plans/line-groups';
import { createGroupBodyFields, createGroupBodySchema } from '@services/budget-plans/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeatureAccess, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  name: createGroupBodyFields.name.describe('Name of the group, 1 to 200 characters, e.g. "Fixed costs"'),
};

export function registerCreateBudgetPlanGroup(server: McpServer) {
  server.registerTool(
    'create_budget_plan_group',
    {
      description:
        'Add a group to a budget plan: a named section that lines sit in, shown after the existing groups. Returns { id, name, sortOrder }. Put lines into it with the line tools. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      requireFeatureAccess({ extra, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_budget_plan_group', clientId: extra.authInfo?.clientId });

      const { name } = createGroupBodySchema.parse({ name: args.name });
      const group = await createGroup({ userId, planId: args.planId, name });

      return jsonContent({ data: group });
    },
  );
}
