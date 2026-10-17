import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addTransactionsToTracker } from '@services/trackers/add-transactions-to-tracker';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker to link transactions to'),
  transactionIds: z.array(recordId()).describe('IDs of the transactions to add to the tracker'),
};

export function registerAddTransactionsToTracker(server: McpServer) {
  server.registerTool(
    'add_transactions_to_tracker',
    {
      description:
        'Manually link one or more transactions to a manual-type tracker. Category-type trackers do not support manual linking. Returns a success message on completion.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'add_transactions_to_tracker', clientId: extra.authInfo?.clientId });

      const result = await addTransactionsToTracker({
        trackerId: args.trackerId,
        userId,
        transactionIds: args.transactionIds,
      });

      return jsonContent({ data: result });
    },
  );
}
