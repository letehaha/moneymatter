import { recordId } from '@common/lib/zod/custom-types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { moveAccountGroup } from '@services/account-groups';

import { presentAccountGroup } from './account-group-output';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  groupId: recordId().describe('ID of the account group to move.'),
  newParentGroupId: recordId()
    .nullable()
    .describe('ID of the group to nest it under, or null to make it a top-level group.'),
};

export function registerMoveAccountGroup(server: McpServer) {
  server.registerTool(
    'move_account_group',
    {
      description:
        'Move an account group under another group, or to the top level with newParentGroupId null. This moves a group, not an account: to put an account in a group use add_account_to_group. Returns the moved group.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'move_account_group', clientId: extra.authInfo?.clientId });

      const [updatedCount, updatedGroups] = await moveAccountGroup({
        groupId: args.groupId,
        newParentGroupId: args.newParentGroupId,
        userId,
      });

      if (updatedCount === 0) {
        throw new NotFoundError({ message: t({ key: 'accounts.groupNotFound' }) });
      }

      return jsonContent({ data: presentAccountGroup({ group: updatedGroups[0]! }) });
    },
  );
}
