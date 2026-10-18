import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bulkDelete } from '@services/transactions/bulk-delete';
import { resolveBulkTargetIds } from '@services/transactions/matching-transactions';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { parseBulkTarget, transactionFilterInput } from './transaction-filter-input';

const inputSchema = {
  transactionIds: z
    .array(recordId())
    .min(1)
    .optional()
    .describe('IDs of the transactions to delete. Give this or filters, not both'),
  // Strict: a misspelled filter key is refused, never dropped, which would widen the delete.
  filters: z
    .object(transactionFilterInput)
    .strict()
    .optional()
    .describe(
      'Delete everything these filters match (the filters of get_transactions_summary), less excludedIds. Give this or transactionIds, not both',
    ),
  excludedIds: z
    .array(recordId())
    .optional()
    .describe(
      'With filters: IDs to keep out of the delete. Leaving out one leg of a transfer keeps the whole transfer',
    ),
};

export function registerBulkDeleteTransactions(server: McpServer) {
  server.registerTool(
    'bulk_delete_transactions',
    {
      description:
        'Permanently delete many transactions at once, by ids or by filters. DESTRUCTIVE: this cannot be undone, and balances change. Before using filters, call get_transactions_summary with the same filters and check the count. Deleting one leg of a transfer deletes both. Transactions on bank-connected accounts are refused (planned ones excepted), and so is a delete over the service maximum. All or nothing. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'bulk_delete_transactions', clientId: extra.authInfo?.clientId });

      const target = parseBulkTarget({
        transactionIds: args.transactionIds,
        filters: args.filters,
        excludedIds: args.excludedIds,
      });
      const transactionIds = await resolveBulkTargetIds({ userId, ...target });
      const result = await bulkDelete({ userId, transactionIds });

      return jsonContent({ data: result });
    },
  );
}
