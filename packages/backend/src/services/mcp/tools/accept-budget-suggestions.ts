import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveTrackerSuggestions } from '@services/budgets/smart-tracking/resolve-suggestions';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of a tracker the user owns'),
  suggestionIds: uniqueRecordIds({ min: 1 }).describe('Suggestion IDs from list_budget_suggestions'),
};

export function registerAcceptBudgetSuggestions(server: McpServer) {
  server.registerTool(
    'accept_budget_suggestions',
    {
      description:
        'Accept pending smart-tracking suggestions of a tracker the user owns (a "budget" in tool and field names): each suggested transaction is linked to the tracker. Suggestion ids come from list_budget_suggestions; fails if any is not pending. Returns resolvedCount.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'accept_budget_suggestions', clientId: extra.authInfo?.clientId });

      const result = await resolveTrackerSuggestions({
        userId,
        budgetId: args.budgetId,
        suggestionIds: args.suggestionIds,
        action: 'accept',
      });

      return jsonContent({ data: result });
    },
  );
}
