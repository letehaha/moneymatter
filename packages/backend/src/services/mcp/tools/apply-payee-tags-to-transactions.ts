import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyPayeeTagsToExisting } from '@services/payees';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  payeeId: recordId().describe('Payee whose default tags to apply (from get_payees).'),
};

export function registerApplyPayeeTagsToTransactions(server: McpServer) {
  server.registerTool(
    'apply_payee_tags_to_transactions',
    {
      description:
        "Add a payee's default tags (set with update_payee) to every transaction already linked to it, planned ones included. It only adds: it never removes a tag, and a tag a transaction already has is skipped. A payee without default tags changes nothing. Returns { updatedTransactionsCount }, the transactions that gained at least one tag. Requires finance:write scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'apply_payee_tags_to_transactions', clientId: extra.authInfo?.clientId });

      const result = await applyPayeeTagsToExisting({ userId, payeeId: args.payeeId });
      return jsonContent({ data: result });
    },
  );
}
