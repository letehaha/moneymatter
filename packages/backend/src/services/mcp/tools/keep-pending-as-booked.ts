import { reconciliationIdsBodySchema } from '@controllers/transactions.controller/reconciliation-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { keepAsBooked } from '@services/transactions/reconciliation/stuck-pending';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transactionIds: reconciliationIdsBodySchema.shape.transactionIds.describe(
    'IDs of the pending transactions to keep as booked (1 to 500, no repeats)',
  ),
};

export function registerKeepPendingAsBooked(server: McpServer) {
  server.registerTool(
    'keep_pending_as_booked',
    {
      description:
        'Confirm that bank-synced pending transactions are real and booked, so they stop showing as stuck. Use it for rows from list_stuck_pending_transactions that have no booked twin because the bank still holds the payment. Only pending bank rows are accepted. Returns { updatedIds }. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'keep_pending_as_booked', clientId: extra.authInfo?.clientId });

      const result = await keepAsBooked({ userId, transactionIds: args.transactionIds });
      return jsonContent({ data: result });
    },
  );
}
