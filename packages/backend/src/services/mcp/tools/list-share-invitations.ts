import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listReceivedInvitations, listSentInvitations } from '@services/sharing/invitations/list-invitations.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentShareInvitation } from './share-output';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const inputSchema = {
  direction: z
    .enum(['sent', 'received', 'both'])
    .optional()
    .describe('sent: invitations you made. received: pending invitations addressed to you. both (default)'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(`How many invitations to return, newest first, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
};

export function registerListShareInvitations(server: McpServer) {
  server.registerTool(
    'list_share_invitations',
    {
      description:
        'List the sharing invitations of the signed-in user: the ones they sent (every status: pending, accepted, declined, revoked, expired) and the pending ones addressed to them. Each has id, direction (sent or received), resourceType (account, household or budget), resourceId, resourceName, permission, policy, status, owner and invitee ({ id, username }, the invitee null until the address belongs to a registered user), expiresAt, createdAt and the accepted/declined/revoked dates. A sent invitation also carries inviteeEmail. Returns { invitations, total }, newest first; total counts the invitations before limit. Read-only: sending, accepting, declining and cancelling invitations is done in the app.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_share_invitations', clientId: extra.authInfo?.clientId });

      const direction = args.direction ?? 'both';
      const [sent, received] = await Promise.all([
        direction === 'received' ? [] : listSentInvitations({ ownerUserId: userId }),
        direction === 'sent' ? [] : listReceivedInvitations({ inviteeUserId: userId }),
      ]);

      const all = [
        ...sent.map((invitation) => ({ invitation, direction: 'sent' as const })),
        ...received.map((invitation) => ({ invitation, direction: 'received' as const })),
      ].toSorted((a, b) => new Date(b.invitation.createdAt).getTime() - new Date(a.invitation.createdAt).getTime());

      return jsonContent({
        data: {
          invitations: all
            .slice(0, args.limit ?? DEFAULT_LIMIT)
            .map(({ invitation, direction: kind }) => presentShareInvitation({ invitation, direction: kind })),
          total: all.length,
        },
      });
    },
  );
}
