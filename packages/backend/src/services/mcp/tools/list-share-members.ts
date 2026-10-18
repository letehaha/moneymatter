import { shareableResourceTypeEnum } from '@controllers/share/_zod';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listMembers } from '@services/sharing/members/list-members.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentShareMembers } from './share-output';

const inputSchema = {
  resourceType: shareableResourceTypeEnum.describe('What is shared: account, household or budget'),
  resourceId: z.string().min(1).max(255).describe('The id of the shared account, household or budget'),
};

export function registerListShareMembers(server: McpServer) {
  server.registerTool(
    'list_share_members',
    {
      description:
        'List who has access to an account, household or budget the signed-in user manages: the owner and every member who accepted. Returns { resourceType, resourceId, resourceName, members }, each member with user ({ id, username }), role (owner or recipient), permission, policy and acceptedAt (null for the owner). Pending invitations are not members: see list_share_invitations. A resource the user does not manage reads as not found. Read-only: changing or removing members is done in the app.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_share_members', clientId: extra.authInfo?.clientId });

      const result = await listMembers({
        userId,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
      });
      return jsonContent({ data: presentShareMembers({ result }) });
    },
  );
}
