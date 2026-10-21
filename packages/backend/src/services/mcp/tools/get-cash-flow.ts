import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCashFlowReport } from '@services/stats/reports/cash-flow.report';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  startDate: z.string().describe('Period start date (ISO 8601). Required.'),
  endDate: z.string().describe('Period end date (ISO 8601). Required.'),
  granularity: z.enum(['monthly', 'biweekly', 'weekly']).optional().describe('Time granularity. Default: monthly'),
  accountId: recordId().optional().describe('Filter by specific account ID'),
  categoryIds: z.array(recordId()).optional().describe('Filter by category IDs'),
};

export function registerGetCashFlow(server: McpServer) {
  server.registerTool(
    'get_cash_flow',
    {
      description:
        'Get income, expenses, and net cash flow for a period with configurable granularity (monthly/biweekly/weekly). Returns period-by-period breakdown plus totals with savings rate.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_cash_flow', clientId: extra.authInfo?.clientId });

      const cashFlow = await getCashFlowReport({
        userId,
        from: args.startDate,
        to: args.endDate,
        granularity: args.granularity ?? 'monthly',
        accountId: args.accountId,
        categoryIds: args.categoryIds,
      });

      return jsonContent({ data: cashFlow });
    },
  );
}
