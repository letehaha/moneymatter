import { getBalanceHistoryReport } from '@services/stats/reports/balance-history.report';
import { getCombinedBalanceHistoryReport } from '@services/stats/reports/combined-balance-history.report';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getBalanceHistoryTool = defineTool({
  name: 'get_balance_history',
  toolset: 'core',
  access: 'read',
  description:
    'Get account balance over time. If accountId is provided, returns balance history for that specific account. Otherwise, returns combined balance across all accounts.',
  input: {
    startDate: z.string().optional().describe('Start date (ISO 8601). Default: 30 days ago'),
    endDate: z.string().optional().describe('End date (ISO 8601). Default: today'),
    accountId: z
      .string()
      .uuid()
      .optional()
      .describe('Specific account ID. Omit for combined balance across all accounts.'),
  },
  run: async ({ userId, args }) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const from = args.startDate ?? thirtyDaysAgo.toISOString();
    const to = args.endDate ?? now.toISOString();

    if (args.accountId) {
      return getBalanceHistoryReport({ userId, accountId: args.accountId, from, to });
    }

    return getCombinedBalanceHistoryReport({ userId, from, to });
  },
});
