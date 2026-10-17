import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removeTransactionsFromTracker } from '@services/trackers/remove-transactions-from-tracker';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker to unlink transactions from'),
  transactionIds: z.array(recordId()).describe('IDs of the transactions to remove from the tracker'),
};

export function registerRemoveTransactionsFromTracker(server: McpServer) {
  server.registerTool(
    'remove_transactions_from_tracker',
    {
      description:
        'Unlink one or more transactions from a tracker. Does not delete the transactions themselves. Returns nothing on success.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'remove_transactions_from_tracker', clientId: extra.authInfo?.clientId });

      await removeTransactionsFromTracker({
        trackerId: args.trackerId,
        userId,
        transactionIds: args.transactionIds,
      });

      return jsonContent({ data: { success: true } });
    },
  );
}
