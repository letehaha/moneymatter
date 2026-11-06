import { listSharedWithMe } from '@services/sharing/members/list-shared-with-me.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { presentSharedWithMe } from './share-output';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const listSharedWithMeTool = defineTool({
  name: 'list_shared_with_me',
  toolset: 'imports',
  access: 'read',
  description:
    'List the accounts, households and trackers other people shared with the signed-in user. Each share has resourceType, resourceId, resourceName (null when the resource is gone), permission, policy, acceptedAt, owner ({ id, username }) and accessSource (share: shared on its own; household: through a household membership). Returns { shares, total }, newest first; total counts the shares before limit. Read-only: leaving a share is done in the app.',
  input: {
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_LIMIT)
      .optional()
      .describe(`How many shares to return, newest first, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
  },
  run: async ({ userId, args }) => {
    const shares = await listSharedWithMe({ userId });
    return {
      shares: shares.slice(0, args.limit ?? DEFAULT_LIMIT).map((share) => presentSharedWithMe({ share })),
      total: shares.length,
    };
  },
});
