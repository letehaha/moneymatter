import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTrends } from '@services/budget-plans/get-trends';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const MAX_COUNT = 24;
const DEFAULT_COUNT = 6;

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  until: recordId()
    .optional()
    .describe('Period ID the trend ends at (from list_budget_plan_periods). Omit: the current period'),
  count: z
    .number()
    .int()
    .min(1)
    .max(MAX_COUNT)
    .optional()
    .describe(`How many periods to return, 1 to ${MAX_COUNT} (default ${DEFAULT_COUNT})`),
};

export function registerGetBudgetPlanTrends(server: McpServer) {
  server.registerTool(
    'get_budget_plan_trends',
    {
      description:
        'Compare the last periods of a budget plan: for each, in order from oldest to newest, what was assigned, the activity (spending is negative), the amount carried in and what was available, in total and per line. Returns { periods: [{ periodId, startDate, endDate, assigned, activity, carriedIn, available, lines: [{ lineId, assigned, activity, available }] }] }. The periods end at `until` (default: the current one). All amounts are decimals in the plan currency.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_budget_plan_trends', clientId: extra.authInfo?.clientId });

      const trends = await getTrends({
        userId,
        planId: args.planId,
        until: args.until,
        count: args.count ?? DEFAULT_COUNT,
      });
      return jsonContent({ data: trends });
    },
  );
}
