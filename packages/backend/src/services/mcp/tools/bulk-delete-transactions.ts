import { recordId } from '@common/lib/zod/custom-types';
import { bulkDelete } from '@services/transactions/bulk-delete';
import { resolveBulkTargetIds } from '@services/transactions/matching-transactions';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { hasNarrowingFilter, parseBulkTarget, transactionFilterInput } from './transaction-filter-input';

export const bulkDeleteTransactionsTool = defineTool({
  name: 'bulk_delete_transactions',
  toolset: 'core',
  access: 'delete',
  description:
    'Permanently delete many transactions at once, by ids or by filters. DESTRUCTIVE: this cannot be undone, and balances change. Before using filters, call get_transactions_summary with the same filters and check the count. Unlike the REST endpoint, empty filters are refused: give at least one filter (a date range, account, category, …) or explicit transactionIds. Deleting one leg of a transfer deletes both. Transactions on bank-connected accounts are refused (planned ones excepted), and so is a delete over the service maximum. Ids you cannot access are skipped; returns deletedIds.',
  input: {
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
  },
  run: async ({ userId, args }) => {
    const target = parseBulkTarget({
      transactionIds: args.transactionIds,
      filters: args.filters,
      excludedIds: args.excludedIds,
    });

    // REST accepts `filters: {}`, which selects everything the caller owns. For an AI client that
    // is one forgotten argument away from wiping the account, so MCP requires a filter that
    // restricts the selection once the REST schema has normalised it, not just a key that is present.
    if (target.selection && !hasNarrowingFilter({ filters: target.selection.filters })) {
      throw new Error(
        'Refusing to delete without a narrowing filter: empty filters would select every transaction you own. Give at least one filter (a date range, account, category, …) or explicit transactionIds',
      );
    }

    const transactionIds = await resolveBulkTargetIds({ userId, ...target });
    return bulkDelete({ userId, transactionIds });
  },
});
