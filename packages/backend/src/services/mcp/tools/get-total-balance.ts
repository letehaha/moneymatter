import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTotalBalanceReport } from '@services/stats/reports/total-balance.report';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  date: z.string().describe('Date to total the balance on (YYYY-MM-DD)'),
};

export function registerGetTotalBalance(server: McpServer) {
  server.registerTool(
    'get_total_balance',
    {
      description:
        "Get the user's total balance across all accounts on one date, as a single number in the base currency. Subtracts credit limits when the user's includeCreditLimitInStats setting is on. For a series over time use get_balance_history.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_total_balance', clientId: extra.authInfo?.clientId });

      return jsonContent({ data: await getTotalBalanceReport({ userId, date: args.date }) });
    },
  );
}
