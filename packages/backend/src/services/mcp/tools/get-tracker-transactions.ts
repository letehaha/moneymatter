import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCategoryTrackerTransactions } from '@services/trackers/get-category-tracker-transactions';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of a category tracker (from get_trackers)'),
  from: z.number().int().min(0).default(0).describe('Offset into the list, 0 or more. Default 0'),
  limit: z.number().int().min(1).max(100).default(50).describe('Page size, 1 to 100. Default 50'),
};

export function registerGetTrackerTransactions(server: McpServer) {
  server.registerTool(
    'get_tracker_transactions',
    {
      description:
        'List the transactions a category tracker counts: those filed under its categories inside its date range, newest first, with one entry per matching split. Works for category trackers only. A manual tracker holds hand-picked transactions: list them with search_transactions and trackerIds. Returns { transactions, total }; page with from and limit. Amounts are decimals: refAmount is in the base currency, amount in the account currency.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_tracker_transactions', clientId: extra.authInfo?.clientId });

      const result = await getCategoryTrackerTransactions({
        userId,
        trackerId: args.trackerId,
        from: args.from,
        limit: args.limit,
      });

      return jsonContent({ data: result });
    },
  );
}
