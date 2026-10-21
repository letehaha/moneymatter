import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteGroup } from '@services/budget-plans/line-groups';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  groupId: recordId().describe('ID of the group to delete (from get_budget_plan_period, in its groups)'),
};

export function registerDeleteBudgetPlanGroup(server: McpServer) {
  server.registerTool(
    'delete_budget_plan_group',
    {
      description:
        'Delete a group of a budget plan. A group that still holds active lines cannot be deleted: move or archive the lines first. Archived lines left in it become ungrouped. This action is irreversible: confirm with the user before calling. Needs a plan that includes budget plans. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await requireFeature({ userId, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_budget_plan_group', clientId: extra.authInfo?.clientId });

      await deleteGroup({ userId, planId: args.planId, groupId: args.groupId });

      return jsonContent({ data: { deleted: true, id: args.groupId, planId: args.planId } });
    },
  );
}
