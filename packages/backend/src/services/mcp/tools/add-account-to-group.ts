import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addAccountToGroup } from '@services/account-groups';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  groupId: recordId().describe('ID of the account group to put the account in.'),
  accountId: recordId().describe('ID of the account to add.'),
};

export function registerAddAccountToGroup(server: McpServer) {
  server.registerTool(
    'add_account_to_group',
    {
      description:
        "Put an account into an account group. An account sits in one group at a time: adding it moves it out of the group it was in. Works for the user's own accounts and for accounts shared with them.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'add_account_to_group', clientId: extra.authInfo?.clientId });

      const grouping = await addAccountToGroup({ groupId: args.groupId, accountId: args.accountId, userId });

      return jsonContent({ data: { groupId: grouping.groupId, accountId: grouping.accountId } });
    },
  );
}
