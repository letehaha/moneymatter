import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removePayeeIgnoredName } from '@services/payees';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  ignoredNameId: recordId().describe('Id of the ignored-list row (from get_ignored_payee_names).'),
};

export function registerUnignorePayeeName(server: McpServer) {
  server.registerTool(
    'unignore_payee_name',
    {
      description:
        'Remove a name from the ignored list, so imports and syncs may turn it into a payee again. Payees and transactions are not changed. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'unignore_payee_name', clientId: extra.authInfo?.clientId });

      await removePayeeIgnoredName({ userId, id: args.ignoredNameId });
      return jsonContent({ data: { deleted: true, ignoredNameId: args.ignoredNameId } });
    },
  );
}
