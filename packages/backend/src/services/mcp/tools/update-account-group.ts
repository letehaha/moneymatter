import { recordId } from '@common/lib/zod/custom-types';
import {
  updateAccountGroupBodyFields,
  updateAccountGroupBodySchema,
} from '@controllers/account-groups/account-group-body.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateAccountGroup } from '@services/account-groups';

import { presentAccountGroup } from './account-group-output';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope, type ToolArgs } from './helpers';

const inputSchema = {
  groupId: recordId().describe('ID of the account group to update.'),
  ...updateAccountGroupBodyFields,
};

export function validateUpdateAccountGroupArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  const { groupId, ...body } = args;
  return { groupId, ...updateAccountGroupBodySchema.parse(body) };
}

export function registerUpdateAccountGroup(server: McpServer) {
  server.registerTool(
    'update_account_group',
    {
      description:
        'Update an account group: name, parentGroupId (a group id to nest it under that group, null for the top level) and logo. Only the fields you send change. A logo is either logoDomain or logoInitials (+ logoColor), not both; null clears a logo field. Returns the updated group.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_account_group', clientId: extra.authInfo?.clientId });

      const group = await updateAccountGroup({ userId, ...validateUpdateAccountGroupArgs({ args }) });

      return jsonContent({ data: presentAccountGroup({ group }) });
    },
  );
}
