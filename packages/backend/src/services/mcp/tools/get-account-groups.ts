import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeAccountGroups } from '@root/serializers/account-groups.serializer';
import { getAccountGroups, getAccountsInGroup } from '@services/account-groups';
import { slimAccountGroupsForMcp } from '@services/mcp/serializers';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  groupId: recordId()
    .optional()
    .describe(
      'Return only the ids of the accounts in this group. Cannot be combined with includeArchived or accountIds.',
    ),
  includeArchived: z.boolean().optional().describe('Include archived accounts inside the groups. Default: false.'),
  accountIds: z
    .array(recordId())
    .optional()
    .describe('Only the groups that contain at least one of these accounts (a group shows just those accounts).'),
};

export function registerGetAccountGroups(server: McpServer) {
  server.registerTool(
    'get_account_groups',
    {
      description:
        'List the user\'s account groups (folders for organizing accounts). Groups nest: the result is a flat list in which every group has parentGroupId (null for a top-level group), a path of group names from the top (for example "Savings > Emergency"), childGroups (id and name) and its accounts. An account sits in at most one group. With accountIds, parent groups that hold none of those accounts are left out, and a path that starts with "…" has a parent missing from the list. With groupId, returns only { groupId, accountIds } for that group.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_account_groups', clientId: extra.authInfo?.clientId });

      const { groupId, includeArchived, accountIds } = args;

      if (groupId) {
        if (includeArchived !== undefined || accountIds !== undefined) {
          throw new Error('groupId cannot be combined with includeArchived or accountIds.');
        }

        const groupings = await getAccountsInGroup({ groupId, userId });
        return jsonContent({ data: { groupId, accountIds: groupings.map((grouping) => grouping.accountId) } });
      }

      const groups = await getAccountGroups({ userId, includeArchived, accountIds });
      return jsonContent({ data: slimAccountGroupsForMcp(serializeAccountGroups(groups)) });
    },
  );
}
