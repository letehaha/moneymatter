import { TRANSACTION_TYPES } from '@bt/shared/types';
import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeSpendingsByCategories } from '@root/serializers/stats.serializer';
import { getSpendingsByCategories } from '@services/stats/get-spendings-by-categories';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  startDate: z.string().optional().describe('Start date (ISO 8601). Default: start of current month'),
  endDate: z.string().optional().describe('End date (ISO 8601). Default: today'),
  accountId: recordId().optional().describe('Filter by specific account ID'),
  transactionType: z
    .enum([TRANSACTION_TYPES.income, TRANSACTION_TYPES.expense])
    .optional()
    .describe('Transaction type. Default: expense'),
  categoryIds: z.array(recordId()).optional().describe('Only include specific category IDs'),
  excludedCategoryIds: z.array(recordId()).optional().describe('Exclude specific category IDs'),
};

export function registerGetSpendingByCategories(server: McpServer) {
  server.registerTool(
    'get_spending_by_categories',
    {
      description:
        'Get spending breakdown by category for a date range. Returns each category with its total amount. Great for understanding where money goes. Defaults to current month expenses.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_spending_by_categories', clientId: extra.authInfo?.clientId });

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const decimals = await getBaseCurrencyDecimals({ userId });
      const spendings = await getSpendingsByCategories({
        userId,
        from: args.startDate ?? startOfMonth.toISOString(),
        to: args.endDate ?? now.toISOString(),
        accountId: args.accountId,
        transactionType: args.transactionType,
        categoryIds: args.categoryIds,
        excludedCategoryIds: args.excludedCategoryIds,
        decimals,
      });

      const serialized = serializeSpendingsByCategories({ spendings, decimals });

      // Convert from object keyed by ID to an array for easier AI consumption
      const categories = Object.entries(serialized).map(([id, data]) => ({
        id,
        ...data,
      }));

      const total = categories.reduce((sum, c) => sum.add(Money.fromDecimal(c.amount)), Money.zero()).toNumber();

      return jsonContent({
        data: {
          period: {
            startDate: args.startDate ?? startOfMonth.toISOString().split('T')[0],
            endDate: args.endDate ?? now.toISOString().split('T')[0],
          },
          categories,
          total,
        },
      });
    },
  );
}
