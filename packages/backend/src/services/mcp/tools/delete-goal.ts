import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteGoal } from '@services/goals/delete-goal';

import { getUserId, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  goalId: recordId().describe('ID of the goal to delete'),
};

export function registerDeleteGoal(server: McpServer) {
  server.registerTool(
    'delete_goal',
    {
      description:
        'Permanently delete a savings goal and free its account shares. Accounts and balances are not touched. Prefer update_goal with status archived to keep it. Returns { success: true }.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await requireFeature({ userId, feature: FEATURES.goals });
      trackMcpToolUsed({ userId, tool: 'delete_goal', clientId: extra.authInfo?.clientId });

      await deleteGoal({ userId, goalId: args.goalId });

      return jsonContent({ data: { success: true } });
    },
  );
}
