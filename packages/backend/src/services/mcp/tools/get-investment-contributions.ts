import { INVESTMENT_CONTRIBUTIONS_GRANULARITIES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getInvestmentContributionsReport } from '@services/stats/reports/investment-contributions.report';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

const inputSchema = {
  ...statsRangeInput,
  granularity: z.enum(INVESTMENT_CONTRIBUTIONS_GRANULARITIES).describe('Period length: monthly, quarterly or yearly'),
  portfolioIds: z.array(recordId()).optional().describe('Only count these portfolios. Unknown ids are dropped.'),
};

export function registerGetInvestmentContributions(server: McpServer) {
  server.registerTool(
    'get_investment_contributions',
    {
      description:
        'Get the money moved into portfolios (net of withdrawals) per period, in the base currency, with the split per portfolio and the net savings of the same period for comparison.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_investment_contributions', clientId: extra.authInfo?.clientId });

      assertStatsRangeOrder({ from: args.from, to: args.to });

      return jsonContent({
        data: await getInvestmentContributionsReport({
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
