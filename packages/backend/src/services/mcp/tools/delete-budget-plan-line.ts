import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteLine } from '@services/budget-plans/delete-line';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  lineId: recordId().describe('ID of the line to delete (from get_budget_plan_period)'),
};

export function registerDeleteBudgetPlanLine(server: McpServer) {
  server.registerTool(
    'delete_budget_plan_line',
    {
      description:
        'Permanently delete a line of a budget plan with all its category memberships and assignments in every period, so its categories become unbudgeted. To stop budgeting a line but keep its history use archive_budget_plan_line instead. This action is irreversible: confirm with the user before calling. Needs a plan that includes budget plans. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await requireFeature({ userId, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_budget_plan_line', clientId: extra.authInfo?.clientId });

      await deleteLine({ userId, planId: args.planId, lineId: args.lineId });

      return jsonContent({ data: { deleted: true, id: args.lineId, planId: args.planId } });
    },
  );
}
