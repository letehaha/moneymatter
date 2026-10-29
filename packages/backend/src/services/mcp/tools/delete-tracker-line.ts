import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteTrackerLine } from '@services/trackers/lines/delete-line';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker the line belongs to'),
  lineId: recordId().describe('ID of the line to delete'),
};

export function registerDeleteTrackerLine(server: McpServer) {
  server.registerTool(
    'delete_tracker_line',
    {
      description:
        'Permanently delete a line from a tracker. Transactions are kept; their spending moves to the next matching line or to "other". Requires manage access to the tracker. Returns { success: true } on completion.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_tracker_line', clientId: extra.authInfo?.clientId });

      await deleteTrackerLine({
        userId,
        trackerId: args.trackerId,
        lineId: args.lineId,
      });

      return jsonContent({ data: { success: true } });
    },
  );
}
