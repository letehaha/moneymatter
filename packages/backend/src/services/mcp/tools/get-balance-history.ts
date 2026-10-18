import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getBalanceHistoryReport } from '@services/stats/reports/balance-history.report';
import { getCombinedBalanceHistoryReport } from '@services/stats/reports/combined-balance-history.report';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  startDate: z.string().optional().describe('Start date (ISO 8601). Default: 30 days ago'),
  endDate: z.string().optional().describe('End date (ISO 8601). Default: today'),
  accountId: z
    .string()
    .uuid()
    .optional()
    .describe('Specific account ID. Omit for combined balance across all accounts.'),
};

export function registerGetBalanceHistory(server: McpServer) {
  server.registerTool(
    'get_balance_history',
    {
      description:
        'Get account balance over time. If accountId is provided, returns balance history for that specific account. Otherwise, returns combined balance across all accounts.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_balance_history', clientId: extra.authInfo?.clientId });

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const from = args.startDate ?? thirtyDaysAgo.toISOString();
      const to = args.endDate ?? now.toISOString();

      if (args.accountId) {
        return jsonContent({ data: await getBalanceHistoryReport({ userId, accountId: args.accountId, from, to }) });
      }

      return jsonContent({ data: await getCombinedBalanceHistoryReport({ userId, from, to }) });
    },
  );
}
