import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPlannedSummary } from '@services/transactions/get-planned-summary';

import { getUserId, jsonContent } from './helpers';

export function registerGetPlannedSummary(server: McpServer) {
  server.registerTool(
    'get_planned_summary',
    {
      description:
        'Totals of the planned (upcoming, not yet confirmed) transactions per account and currency: plannedDelta in the account currency, refPlannedDelta in the base currency, the number of plans and the latest plan date. An expense counts negative. Use search_transactions with isPlanned to list the plans themselves.',
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_planned_summary', clientId: extra.authInfo?.clientId });

      const summary = await getPlannedSummary({ userId });

      return jsonContent({ data: summary });
    },
  );
}
