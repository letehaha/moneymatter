import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeBudgetSpendingStats, serializeBudgetStats } from '@root/serializers';
import { getBudgetSpendingStats } from '@services/budgets/spending-stats';
import { getBudgetStats } from '@services/budgets/stats';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of the tracker to retrieve spending stats for'),
};

export function registerGetBudgetSpendingStats(server: McpServer) {
  server.registerTool(
    'get_budget_spending_stats',
    {
      description:
        'Get spending statistics for a tracker (a "budget" in tool and field names): spending broken down by category and a time-series of expense vs income over the tracker period. Granularity is daily for ranges ≤62 days, weekly ≤184 days, monthly otherwise. Also returns spending by original currency, the top 5 payees, the biggest spending day, a summary (income, expense, balance, limit utilization %), per-line spent (`lines: [{ lineId, spent }]`, match lineId against get_budgets lines) and `otherSpent` for spending that matches no line. Amounts are decimals.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_budget_spending_stats', clientId: extra.authInfo?.clientId });

      const [spendingStats, stats] = await Promise.all([
        getBudgetSpendingStats({ userId, budgetId: args.budgetId }),
        getBudgetStats({ userId, budgetId: args.budgetId }),
      ]);

      return jsonContent({ data: { ...serializeBudgetSpendingStats(spendingStats), ...serializeBudgetStats(stats) } });
    },
  );
}
