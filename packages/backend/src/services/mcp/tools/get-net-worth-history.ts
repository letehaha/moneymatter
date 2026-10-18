import { NET_WORTH_HISTORY_GRANULARITIES } from '@bt/shared/types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getNetWorthHistoryReport } from '@services/stats/reports/net-worth-history.report';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

const inputSchema = {
  ...statsRangeInput,
  granularity: z
    .enum(NET_WORTH_HISTORY_GRANULARITIES)
    .describe('Spacing of the points: weekly, monthly, quarterly or yearly'),
};

export function registerGetNetWorthHistory(server: McpServer) {
  server.registerTool(
    'get_net_worth_history',
    {
      description:
        'Get net worth over time as points, each with assets by kind (cash, investments, vehicles, ventures), liabilities by kind (loans, credit cards) and the net worth, in the base currency. Subtracts credit limits when the includeCreditLimitInStats setting is on. A degraded field lists securities or currencies that could not be priced.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_net_worth_history', clientId: extra.authInfo?.clientId });

      assertStatsRangeOrder({ from: args.from, to: args.to });

      return jsonContent({
        data: await getNetWorthHistoryReport({
          userId,
          from: args.from,
          to: args.to,
          granularity: args.granularity,
        }),
      });
    },
  );
}
