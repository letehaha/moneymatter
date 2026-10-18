import { PIVOT_GRANULARITIES, PIVOT_MEASURES, PIVOT_ROW_DIMENSIONS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPivotTableReport } from '@services/stats/reports/pivot.report';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { assertStatsRangeOrder, statsRangeInput } from './stats-input';

const inputSchema = {
  ...statsRangeInput,
  granularity: z.enum(PIVOT_GRANULARITIES).describe('Column size: yearly, quarterly, monthly or weekly'),
  rowDimension: z.enum(PIVOT_ROW_DIMENSIONS).describe('What the rows are: category, subcategory, payee or tag'),
  measure: z.enum(PIVOT_MEASURES).describe('What to sum: expense or income'),
  accountIds: z.array(recordId()).optional().describe('Only these accounts'),
  categoryIds: z.array(recordId()).optional().describe('Only these categories (a parent includes its subcategories)'),
  payeeIds: z.array(recordId()).optional().describe('Only these payees'),
};

export function registerGetPivotReport(server: McpServer) {
  server.registerTool(
    'get_pivot_report',
    {
      description:
        'Cross-tab spending or income: rows by category, subcategory, payee or tag against time columns (yearly, quarterly, monthly, weekly), with row and column totals, in the base currency. Splits are distributed and refunds netted, so a refunded amount never counts as spend.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_pivot_report', clientId: extra.authInfo?.clientId });

      assertStatsRangeOrder({ from: args.from, to: args.to });

      return jsonContent({
        data: await getPivotTableReport({
          userId,
          from: args.from,
          to: args.to,
          granularity: args.granularity,
          rowDimension: args.rowDimension,
          measure: args.measure,
          accountIds: args.accountIds,
          categoryIds: args.categoryIds,
          payeeIds: args.payeeIds,
        }),
      });
    },
  );
}
