import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getScheduled } from '@services/budget-plans/get-scheduled';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  periodId: recordId().describe('Period ID (from list_budget_plan_periods)'),
};

export function registerGetBudgetPlanScheduled(server: McpServer) {
  server.registerTool(
    'get_budget_plan_scheduled',
    {
      description:
        'List what is still scheduled in a period of a budget plan, from today on: subscription payments and planned transactions dated in the period. Returns { items, outflows, inflows, nextDate }. Each item has source ("subscription" or "planned"), id, name, date, amount (signed, in the plan currency: outflows are negative), currencyCode and nativeAmount (in that currency), categoryId, lineId (the plan line that covers it, or null) and accountId. outflows and inflows hold the signed total and the count. A past period returns no items.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_budget_plan_scheduled', clientId: extra.authInfo?.clientId });

      const scheduled = await getScheduled({ userId, planId: args.planId, periodId: args.periodId });
      return jsonContent({ data: scheduled });
    },
  );
}
