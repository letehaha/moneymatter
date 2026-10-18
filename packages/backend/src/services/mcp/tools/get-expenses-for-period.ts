import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getExpensesAmountForPeriodReport } from '@services/stats/reports/expenses-amount-for-period.report';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  startDate: z.string().optional().describe('Start date (ISO 8601). Default: start of current month'),
  endDate: z.string().optional().describe('End date (ISO 8601). Default: today'),
  accountId: recordId().optional().describe('Filter by specific account ID'),
  excludedCategoryIds: z.array(recordId()).optional().describe('Exclude specific category IDs from total'),
};

export function registerGetExpensesForPeriod(server: McpServer) {
  server.registerTool(
    'get_expenses_for_period',
    {
      description:
        'Get total expense amount for a date range. Returns a single total number. Use this for quick "how much did I spend" queries instead of summing transactions manually.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_expenses_for_period', clientId: extra.authInfo?.clientId });

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const totalExpenses = await getExpensesAmountForPeriodReport({
        userId,
        from: args.startDate ?? startOfMonth.toISOString(),
        to: args.endDate ?? now.toISOString(),
        accountId: args.accountId,
        excludedCategoryIds: args.excludedCategoryIds,
      });

      return jsonContent({
        data: {
          totalExpenses,
          period: {
            startDate: args.startDate ?? startOfMonth.toISOString().split('T')[0],
            endDate: args.endDate ?? now.toISOString().split('T')[0],
          },
        },
      });
    },
  );
}
