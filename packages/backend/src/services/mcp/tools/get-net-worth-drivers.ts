import { NET_WORTH_DRIVERS_GRANULARITIES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getNetWorthDriversReport } from '@services/stats/reports/net-worth-drivers.report';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

const inputSchema = {
  ...statsRangeInput,
  granularity: z.enum(NET_WORTH_DRIVERS_GRANULARITIES).describe('Period length: monthly, quarterly or yearly'),
  portfolioIds: z
    .array(recordId())
    .optional()
    .describe('Scope the investment part to these portfolios. Savings stay user-wide. Unknown ids are dropped.'),
};

export function registerGetNetWorthDrivers(server: McpServer) {
  server.registerTool(
    'get_net_worth_drivers',
    {
      description:
        'Explain what moved net worth, period by period, in the base currency: savings (income, expenses, net), investment growth (price effect, dividends, fees and taxes, per portfolio) and the holdings and cash values at the end of the period. A degraded field lists securities or currencies that could not be priced.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_net_worth_drivers', clientId: extra.authInfo?.clientId });

      assertStatsRangeOrder({ from: args.from, to: args.to });

      return jsonContent({
        data: await getNetWorthDriversReport({
          userId,
          from: args.from,
          to: args.to,
          granularity: args.granularity,
          portfolioIds: args.portfolioIds,
        }),
      });
    },
  );
}
