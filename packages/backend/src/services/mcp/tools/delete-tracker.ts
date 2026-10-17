import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteTracker } from '@services/trackers/delete-tracker';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker to delete'),
};

export function registerDeleteTracker(server: McpServer) {
  server.registerTool(
    'delete_tracker',
    {
      description:
        'Permanently delete a tracker and all its transaction links. This action cannot be undone. Returns { success: true } on completion.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_tracker', clientId: extra.authInfo?.clientId });

      const result = await deleteTracker({ id: args.trackerId, userId });

      return jsonContent({ data: result });
    },
  );
}
