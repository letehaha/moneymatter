import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deletePayeeAlias } from '@services/payees';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  payeeId: recordId().describe('Payee the alias belongs to.'),
  aliasId: recordId().describe('Alias id (from get_payee).'),
};

export function registerDeletePayeeAlias(server: McpServer) {
  server.registerTool(
    'delete_payee_alias',
    {
      description:
        "Delete one alias of a payee. Transactions already linked through it keep their payee; only future matching changes. The alias that is the payee's own name cannot be deleted (rename the payee with update_payee instead). Requires finance:delete scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_payee_alias', clientId: extra.authInfo?.clientId });

      await deletePayeeAlias({ userId, payeeId: args.payeeId, aliasId: args.aliasId });
      return jsonContent({ data: { deleted: true, aliasId: args.aliasId } });
    },
  );
}
