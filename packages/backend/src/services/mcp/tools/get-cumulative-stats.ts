import { CUMULATIVE_METRICS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCumulativeDataReport } from '@services/stats/reports/cumulative-data.report';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

const ids = ({ description }: { description: string }) => z.array(recordId()).optional().describe(description);

const inputSchema = {
  ...statsRangeInput,
  metric: z.enum(CUMULATIVE_METRICS).describe('What to accumulate: expenses, income or savings'),
  accountId: recordId().optional().describe('Only this account'),
  accountIds: ids({ description: 'Only these accounts (wins over accountId)' }),
  payeeIds: ids({ description: 'Only these payees' }),
  excludedPayeeIds: ids({ description: 'Leave out these payees' }),
  tagIds: ids({ description: 'Only transactions with these tags' }),
  excludedTagIds: ids({ description: 'Leave out transactions with these tags' }),
  categoryIds: ids({ description: 'Only these categories (a parent includes its subcategories)' }),
  excludedCategoryIds: ids({ description: 'Leave out these categories (a parent hides its subcategories)' }),
};

export function registerGetCumulativeStats(server: McpServer) {
  server.registerTool(
    'get_cumulative_stats',
    {
      description:
        'Get running totals of expenses, income or savings by month for a period, next to the period of the same length right before it, plus the percent change, in the base currency. Use it for "am I spending more than last quarter so far".',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_cumulative_stats', clientId: extra.authInfo?.clientId });

      assertStatsRangeOrder({ from: args.from, to: args.to });

      return jsonContent({
        data: await getCumulativeDataReport({
          userId,
          from: args.from,
          to: args.to,
          metric: args.metric,
          accountId: args.accountId,
          accountIds: args.accountIds,
          payeeIds: args.payeeIds,
          excludedPayeeIds: args.excludedPayeeIds,
          tagIds: args.tagIds,
          excludedTagIds: args.excludedTagIds,
          categoryIds: args.categoryIds,
          excludedCategoryIds: args.excludedCategoryIds,
        }),
      });
    },
  );
}
