import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteAutomation } from '@services/transaction-automations/delete-automation';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  id: recordId().describe('UUID of the automation to delete'),
};

export function registerDeleteTransactionAutomation(server: McpServer) {
  server.registerTool(
    'delete_transaction_automation',
    {
      description:
        'Permanently delete a transaction automation rule. Transactions the rule already changed keep their values. This cannot be undone, so only call it when the user explicitly confirms deletion; to stop a rule temporarily set isEnabled to false via update_transaction_automation instead. Returns { success: true } on completion. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_transaction_automation', clientId: extra.authInfo?.clientId });

      await deleteAutomation({ userId, id: args.id });

      return jsonContent({ data: { success: true } });
    },
  );
}
