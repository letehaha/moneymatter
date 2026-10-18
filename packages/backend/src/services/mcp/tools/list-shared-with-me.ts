import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listSharedWithMe } from '@services/sharing/members/list-shared-with-me.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';
import { presentSharedWithMe } from './share-output';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const inputSchema = {
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(`How many shares to return, newest first, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
};

export function registerListSharedWithMe(server: McpServer) {
  server.registerTool(
    'list_shared_with_me',
    {
      description:
        'List the accounts, households and budgets other people shared with the signed-in user. Each share has resourceType, resourceId, resourceName (null when the resource is gone), permission, policy, acceptedAt, owner ({ id, username }) and accessSource (share: shared on its own; household: through a household membership). Returns { shares, total }, newest first; total counts the shares before limit. Read-only: leaving a share is done in the app.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_shared_with_me', clientId: extra.authInfo?.clientId });

      const shares = await listSharedWithMe({ userId });
      return jsonContent({
        data: {
          shares: shares.slice(0, args.limit ?? DEFAULT_LIMIT).map((share) => presentSharedWithMe({ share })),
          total: shares.length,
        },
      });
    },
  );
}
