import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getStuckPending } from '@services/transactions/reconciliation/stuck-pending';

import { getUserId, jsonContent } from './helpers';
import { presentTransactions } from './transaction-output';

export function registerListStuckPendingTransactions(server: McpServer) {
  server.registerTool(
    'list_stuck_pending_transactions',
    {
      description:
        'List bank-synced transactions that have been pending for more than 7 days, so the bank probably booked them under a different row. Returns { pending: [{ transaction, candidate, pendingDays }] }: candidate is the booked transaction that most likely replaced the pending one, or null. When the candidate is the same purchase, remove the pending row with remove_duplicate_transactions or merge both with merge_duplicate_transactions; when the bank really still holds the payment, confirm the row with keep_pending_as_booked. Transfers and refund-linked rows are not listed.',
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_stuck_pending_transactions', clientId: extra.authInfo?.clientId });

      const items = await getStuckPending({ userId });

      // One name lookup serves every transaction and candidate; slim rows are matched back by id.
      const apiRows = items.flatMap((item) =>
        item.candidate ? [item.transaction, item.candidate] : [item.transaction],
      );
      const slimById = new Map((await presentTransactions({ userId, transactions: apiRows })).map((tx) => [tx.id, tx]));

      const pending = items.map((item) => ({
        transaction: slimById.get(item.transaction.id),
        candidate: item.candidate ? slimById.get(item.candidate.id) : null,
        pendingDays: item.pendingDays,
      }));

      return jsonContent({ data: { pending } });
    },
  );
}
