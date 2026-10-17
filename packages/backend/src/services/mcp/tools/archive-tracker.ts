import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTracker } from '@root/serializers/trackers.serializer';
import { toggleTrackerArchive } from '@services/trackers/toggle-archive';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker to archive or unarchive'),
  isArchived: z.boolean().describe('true to archive the tracker, false to restore it to active'),
};

export function registerArchiveTracker(server: McpServer) {
  server.registerTool(
    'archive_tracker',
    {
      description:
        'Archive or unarchive a tracker. Pass isArchived: true to archive (sets status to "archived"), false to restore it to active. Returns the updated tracker.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'archive_tracker', clientId: extra.authInfo?.clientId });

      const tracker = await toggleTrackerArchive({ id: args.trackerId, userId, isArchived: args.isArchived });

      return jsonContent({ data: serializeTracker(tracker) });
    },
  );
}
