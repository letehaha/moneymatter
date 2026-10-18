import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteAccountGroup } from '@services/account-groups';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  groupId: recordId().describe('ID of the account group to delete.'),
};

export function registerDeleteAccountGroup(server: McpServer) {
  server.registerTool(
    'delete_account_group',
    {
      description:
        'Delete an account group. Its accounts are not deleted: they are only taken out of the group. Automations that reference the group are paused. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_account_group', clientId: extra.authInfo?.clientId });

      await deleteAccountGroup({ groupId: args.groupId, userId });

      return jsonContent({ data: { deleted: true, groupId: args.groupId } });
    },
  );
}
