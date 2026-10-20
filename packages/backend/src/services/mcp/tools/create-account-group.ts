import {
  createAccountGroupBodyFields,
  createAccountGroupBodySchema,
} from '@controllers/account-groups/account-group-body.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createAccountGroup } from '@services/account-groups';

import { presentAccountGroup } from './account-group-output';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope, type ToolArgs } from './helpers';

const inputSchema = createAccountGroupBodyFields;

export function validateCreateAccountGroupArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  return createAccountGroupBodySchema.parse(args);
}

export function registerCreateAccountGroup(server: McpServer) {
  server.registerTool(
    'create_account_group',
    {
      description:
        'Create an account group (a folder for accounts). Give parentGroupId to nest it under another group, or leave it out (or null) for a top-level group. Put accounts in it afterwards with add_account_to_group. Give a logo as either logoDomain or logoInitials (+ logoColor), not both.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_account_group', clientId: extra.authInfo?.clientId });

      const { name, parentGroupId, logoDomain, logoInitials, logoColor } = validateCreateAccountGroupArgs({ args });

      const group = await createAccountGroup({
        userId,
        name,
        parentGroupId,
        logoDomain,
        logoInitials,
        logoColor,
      });

      return jsonContent({ data: presentAccountGroup({ group }) });
    },
  );
}
