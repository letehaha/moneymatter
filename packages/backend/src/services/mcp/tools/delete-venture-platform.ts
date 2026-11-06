import { recordId } from '@common/lib/zod/custom-types';
import { deleteVenturePlatform } from '@services/venture/platforms/delete.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteVenturePlatformTool = defineTool({
  name: 'delete_venture_platform',
  toolset: 'ventures',
  access: 'delete',
  description:
    "Delete a venture platform. Existing deals that reference it have their platformId cleared (deals are preserved). With force=true, hard-deletes the platform; otherwise it is soft-deleted. Confirm with the user before calling — operates against the user's records.",
  input: {
    platformId: recordId().describe('Venture platform ID (from list_venture_platforms)'),
    force: z.boolean().optional().describe('If true, hard-delete the platform. Default: false (soft-delete).'),
  },
  run: ({ userId, args }) =>
    deleteVenturePlatform({
      userId,
      platformId: args.platformId,
      force: args.force,
    }),
});
