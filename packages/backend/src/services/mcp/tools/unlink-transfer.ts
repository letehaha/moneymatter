import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { unlinkTransferTransactions } from '@services/transactions/transactions-linking/unlink-transfer-transactions';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transferIds: z
    .array(z.string())
    .min(1)
    .describe('One or more transferId UUID strings identifying transfer pairs to unlink'),
};

export function registerUnlinkTransfer(server: McpServer) {
  server.registerTool(
    'unlink_transfer',
    {
      description:
        'Unlink transfer transactions by their shared transferId (UUID string). Both transactions in the pair will become independent income/expense entries. Use search_transactions to find the transferId of a linked pair.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'unlink_transfer', clientId: extra.authInfo?.clientId });

      const result = await unlinkTransferTransactions({ userId, transferIds: args.transferIds });

      return jsonContent({ data: serializeTransactions(result) });
    },
  );
}
