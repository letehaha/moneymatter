import { SORT_DIRECTIONS, TRANSACTION_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { slimTransactionsForMcp } from '@services/mcp/serializers';
import { getTransactions } from '@services/transactions/get-transactions';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  startDate: z.string().optional().describe('Start date (ISO 8601). Default: 30 days ago'),
  endDate: z.string().optional().describe('End date (ISO 8601). Default: today'),
  accountIds: z.array(recordId()).optional().describe('Filter by account IDs'),
  categoryIds: z.array(recordId()).optional().describe('Filter by category IDs'),
  tagIds: z.array(recordId()).optional().describe('Filter by tag IDs'),
  transactionType: z
    .enum([TRANSACTION_TYPES.income, TRANSACTION_TYPES.expense])
    .optional()
    .describe('Filter by transaction type'),
  amountMin: z.number().optional().describe('Minimum amount (decimal, in original currency)'),
  amountMax: z.number().optional().describe('Maximum amount (decimal, in original currency)'),
  search: z.string().optional().describe('Search in transaction notes'),
  limit: z.number().optional().describe('Max results (default: 50, max: 500)'),
  offset: z.number().optional().describe('Pagination offset (default: 0)'),
  order: z.enum(['asc', 'desc']).optional().describe('Sort order by date (default: desc)'),
  excludeTransfers: z.boolean().optional().describe('Exclude transfer transactions'),
  excludeRefunds: z.boolean().optional().describe('Exclude refund transactions'),
};

export function registerSearchTransactions(server: McpServer) {
  server.registerTool(
    'search_transactions',
    {
      description:
        'Search and filter transactions. Returns transaction amount (original + base currency), category, account, note, date, type, and tags. Use date filters to limit results. Default: last 30 days, 50 items.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'search_transactions', clientId: extra.authInfo?.clientId });

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const limit = Math.min(args.limit ?? 50, 500);

      const startDate = args.startDate ?? thirtyDaysAgo.toISOString();
      const endDate = args.endDate ?? now.toISOString();

      const filterParams = {
        userId,
        startDate,
        endDate,
        accountIds: args.accountIds,
        categoryIds: args.categoryIds,
        tagIds: args.tagIds,
        transactionType: args.transactionType as TRANSACTION_TYPES | undefined,
        amountGte: args.amountMin !== undefined ? Money.fromDecimal(args.amountMin) : undefined,
        amountLte: args.amountMax !== undefined ? Money.fromDecimal(args.amountMax) : undefined,
        noteSearch: args.search ? [args.search] : undefined,
        limit,
        from: args.offset ?? 0,
        order: args.order === 'asc' ? SORT_DIRECTIONS.asc : SORT_DIRECTIONS.desc,
        excludeTransfer: args.excludeTransfers,
        excludeRefunds: args.excludeRefunds,
      };

      const transactions = await getTransactions(filterParams);

      const serialized = slimTransactionsForMcp(serializeTransactions(transactions));

      return jsonContent({
        data: {
          transactions: serialized,
          count: serialized.length,
          limit,
          offset: args.offset ?? 0,
        },
      });
    },
  );
}
