import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteLineGoal } from '@services/budget-plans/line-goals';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeatureAccess, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  lineId: recordId().describe('ID of the line whose goal to delete (from get_budget_plan_period)'),
};

export function registerDeleteBudgetPlanLineGoal(server: McpServer) {
  server.registerTool(
    'delete_budget_plan_line_goal',
    {
      description:
        'Delete the goal of a budget plan line. The line and its assignments stay; only the goal is removed, and the snooze with it. Fails if the line has no goal. This action is irreversible: confirm with the user before calling. Needs a plan that includes budget plans. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      requireFeatureAccess({ extra, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_budget_plan_line_goal', clientId: extra.authInfo?.clientId });

      await deleteLineGoal({ userId, planId: args.planId, lineId: args.lineId });

      return jsonContent({ data: { deleted: true, lineId: args.lineId, planId: args.planId } });
    },
  );
}
