import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTransactionGroup } from '@services/transaction-groups';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: z.string().describe('Display name for the group'),
  transactionIds: z.array(recordId()).describe('IDs of transactions to include in the group (minimum 2, maximum 50)'),
  note: z.string().max(500).optional().describe('Optional note or description for the group'),
};

export function registerCreateTransactionGroup(server: McpServer) {
  server.registerTool(
    'create_transaction_group',
    {
      description:
        'Create a new transaction group that bundles related transactions together (e.g. a split bill). Requires at least 2 transactions. Transfer pairs are automatically included. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_transaction_group', clientId: extra.authInfo?.clientId });

      const result = await createTransactionGroup({
        userId,
        name: args.name,
        transactionIds: args.transactionIds,
        note: args.note,
      });

      return jsonContent({ data: result });
    },
  );
}
