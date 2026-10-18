import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEarliestTransactionDateReport } from '@services/stats/reports/earliest-transaction-date.report';

import { getUserId, jsonContent } from './helpers';

export function registerGetEarliestTransactionDate(server: McpServer) {
  server.registerTool(
    'get_earliest_transaction_date',
    {
      description:
        'Get the date (YYYY-MM-DD) of the first transaction on record, or null when there are none. Planned future transactions do not count. Use it to pick a start date for the report tools.',
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_earliest_transaction_date', clientId: extra.authInfo?.clientId });

      return jsonContent({ data: await getEarliestTransactionDateReport({ userId }) });
    },
  );
}
