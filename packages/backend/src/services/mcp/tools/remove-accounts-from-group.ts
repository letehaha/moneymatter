import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removeAccountFromGroup } from '@services/account-groups';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  groupId: recordId().describe('ID of the account group to take the accounts out of.'),
  accountIds: z.array(recordId()).describe('IDs of the accounts to remove from the group.'),
};

export function registerRemoveAccountsFromGroup(server: McpServer) {
  server.registerTool(
    'remove_accounts_from_group',
    {
      description: 'Take accounts out of an account group. The accounts are not deleted, they just become ungrouped.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'remove_accounts_from_group', clientId: extra.authInfo?.clientId });

      await removeAccountFromGroup({ groupId: args.groupId, accountIds: args.accountIds, userId });

      return jsonContent({ data: { removed: true, groupId: args.groupId, accountIds: args.accountIds } });
    },
  );
}
