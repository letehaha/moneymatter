import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getVentureContributionsReport } from '@services/stats/reports/venture-contributions.report';

import { getUserId, jsonContent } from './helpers';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

const inputSchema = { ...statsRangeInput };

export function registerGetVentureContributions(server: McpServer) {
  server.registerTool(
    'get_venture_contributions',
    {
      description:
        'Get the net amount contributed to each venture deal in a date range, in the base currency. Each item has the deal id, its name and the amount.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_venture_contributions', clientId: extra.authInfo?.clientId });

      assertStatsRangeOrder({ from: args.from, to: args.to });

      return jsonContent({ data: await getVentureContributionsReport({ userId, from: args.from, to: args.to }) });
    },
  );
}
