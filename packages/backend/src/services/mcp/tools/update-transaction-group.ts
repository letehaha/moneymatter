import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateTransactionGroup } from '@services/transaction-groups';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  id: recordId().describe('ID of the transaction group to update'),
  name: z.string().optional().describe('New display name for the group'),
  note: z.string().nullable().optional().describe('New note for the group (pass null to clear)'),
};

export function registerUpdateTransactionGroup(server: McpServer) {
  server.registerTool(
    'update_transaction_group',
    {
      description:
        'Update the name or note of an existing transaction group. To change group membership use add_transactions_to_group or remove_transactions_from_group. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_transaction_group', clientId: extra.authInfo?.clientId });

      const result = await updateTransactionGroup({
        id: args.id,
        userId,
        name: args.name,
        note: args.note,
      });

      return jsonContent({ data: result });
    },
  );
}
