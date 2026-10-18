import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSuggestionContext } from '@services/budget-plans/suggested-lines';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  accountIds: z
    .array(recordId())
    .optional()
    .describe(
      'Accounts whose last three full months of spending are read (from get_accounts). Omit: no history is read',
    ),
};

export function registerGetBudgetPlanSuggestionContext(server: McpServer) {
  server.registerTool(
    'get_budget_plan_suggestion_context',
    {
      description:
        'Read what a new budget plan could start from, before creating one: the top spending categories of the given accounts over the last three full months. Returns { hasHistory, categories: [{ id, monthlyAvg }] }, monthlyAvg being the average per month in the base currency as a decimal. Without history (or without accountIds), hasHistory is false and the categories are a starter set with monthlyAvg null. Nothing is created.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_budget_plan_suggestion_context', clientId: extra.authInfo?.clientId });

      const context = await getSuggestionContext({ userId, accountIds: args.accountIds ?? [] });
      return jsonContent({ data: context });
    },
  );
}
