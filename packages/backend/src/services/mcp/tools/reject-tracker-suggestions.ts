import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveTrackerSuggestions } from '@services/trackers/smart-tracking/resolve-suggestions';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of a tracker the user owns'),
  suggestionIds: uniqueRecordIds({ min: 1 }).describe('Suggestion IDs from list_tracker_suggestions'),
};

export function registerRejectTrackerSuggestions(server: McpServer) {
  server.registerTool(
    'reject_tracker_suggestions',
    {
      description:
        'Reject smart-tracking suggestions of a tracker the user owns: pending ones are dismissed, and AI-linked or accepted ones are also unlinked from the tracker. The AI will not suggest these transactions again. Suggestion ids come from list_tracker_suggestions (pending or aiMatched). Returns resolvedCount.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'reject_tracker_suggestions', clientId: extra.authInfo?.clientId });

      const result = await resolveTrackerSuggestions({
        userId,
        trackerId: args.trackerId,
        suggestionIds: args.suggestionIds,
        action: 'reject',
      });

      return jsonContent({ data: result });
    },
  );
}
