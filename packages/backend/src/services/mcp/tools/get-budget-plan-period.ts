import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPeriodView } from '@services/budget-plans/get-period-view';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  periodId: recordId().describe('Period ID (from list_budget_plan_periods)'),
};

export function registerGetBudgetPlanPeriod(server: McpServer) {
  server.registerTool(
    'get_budget_plan_period',
    {
      description:
        'Read one period of a budget plan: the figures behind the Budget screen. Returns { period, header, groups, lines, pool, unbudgeted, goals, coverage }. header has totalAssigned, totalActivity (spending is negative), totalCarriedIn and totalAvailable. Each line has what was assigned, its activity and what is available, with its goal progress when it has a goal. pool (null without a pool) has readyToAssign, committedLater, the flow and the balance. unbudgeted lists the category activity no line covers. coverage tells how ready the next period is. All amounts are decimals in the plan currency (list_budget_plans, currencyCode).',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_budget_plan_period', clientId: extra.authInfo?.clientId });

      const view = await getPeriodView({ userId, planId: args.planId, periodId: args.periodId });
      return jsonContent({ data: view });
    },
  );
}
