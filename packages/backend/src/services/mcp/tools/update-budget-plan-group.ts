import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateGroup } from '@services/budget-plans/line-groups';
import { updateGroupBodyFields, updateGroupBodySchema } from '@services/budget-plans/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  groupId: recordId().describe('ID of the group to rename (from get_budget_plan_period, in its groups)'),
  name: updateGroupBodyFields.name.describe('New name, 1 to 200 characters'),
};

export function registerUpdateBudgetPlanGroup(server: McpServer) {
  server.registerTool(
    'update_budget_plan_group',
    {
      description:
        'Rename a group of a budget plan. Returns { id, name, sortOrder }. To reorder groups use the layout tool. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await requireFeature({ userId, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_budget_plan_group', clientId: extra.authInfo?.clientId });

      const { name } = updateGroupBodySchema.parse({ name: args.name });
      const group = await updateGroup({ userId, planId: args.planId, groupId: args.groupId, name });

      return jsonContent({ data: group });
    },
  );
}
