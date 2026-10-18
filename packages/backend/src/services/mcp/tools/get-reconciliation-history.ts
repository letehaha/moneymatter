import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getReconciliationHistory } from '@services/transactions/reconciliation/get-history';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentTransactions } from './transaction-output';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const inputSchema = {
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(`How many of the newest events to return, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
};

export function registerGetReconciliationHistory(server: McpServer) {
  server.registerTool(
    'get_reconciliation_history',
    {
      description:
        'List the duplicate cleanups that removed transactions, newest first. Each event is a removal ({ type: "remove", removedAt, transactions }) or a merge ({ type: "merge", removedAt, transactions, survivor }), where transactions are the rows taken out of the books and survivor is the row they were merged into. Returns { events, total }, total being the number of events before limit. Pass the ids of the removed rows to restore_removed_transactions to bring them back.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_reconciliation_history', clientId: extra.authInfo?.clientId });

      const all = await getReconciliationHistory({ userId });
      const page = all.slice(0, args.limit ?? DEFAULT_LIMIT);

      // One name lookup serves the whole page; the slim rows are matched back to their events by id.
      const apiRows = page.flatMap((event) =>
        event.survivor ? [...event.transactions, event.survivor] : event.transactions,
      );
      const slimById = new Map((await presentTransactions({ userId, transactions: apiRows })).map((tx) => [tx.id, tx]));

      const events = page.map((event) => ({
        type: event.type,
        removedAt: event.removedAt,
        transactions: event.transactions.map((tx) => slimById.get(tx.id)),
        survivor: event.survivor ? slimById.get(event.survivor.id) : null,
      }));

      return jsonContent({ data: { events, total: all.length } });
    },
  );
}
