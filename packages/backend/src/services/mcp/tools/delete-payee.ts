import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deletePayee, deletePayeeAndIgnoreFuture } from '@services/payees';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  id: z.string().describe('Payee id to delete.'),
  ignoreFuture: z
    .boolean()
    .optional()
    .describe('true also adds the payee names to the ignore list, so imports never recreate it. Default false'),
};

export function registerDeletePayee(server: McpServer) {
  server.registerTool(
    'delete_payee',
    {
      description:
        'Delete a Payee. Linked transactions retain their categoryId but their payeeId is set to null. Use cautiously — this is irreversible. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_payee', clientId: extra.authInfo?.clientId });
      if (args.ignoreFuture) {
        const { addedCount } = await deletePayeeAndIgnoreFuture({ userId, payeeId: args.id });
        return jsonContent({ data: { ok: true, ignoredAddedCount: addedCount } });
      }
      await deletePayee({ userId, id: args.id });
      return jsonContent({ data: { ok: true } });
    },
  );
}
