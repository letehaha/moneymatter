import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveTrackerSuggestions } from '@services/trackers/smart-tracking/resolve-suggestions';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of a tracker the user owns'),
  suggestionIds: uniqueRecordIds({ min: 1 }).describe('Suggestion IDs from list_tracker_suggestions'),
};

export function registerAcceptTrackerSuggestions(server: McpServer) {
  server.registerTool(
    'accept_tracker_suggestions',
    {
      description:
        'Accept pending smart-tracking suggestions of a tracker the user owns: each suggested transaction is linked to the tracker. Suggestion ids come from list_tracker_suggestions; fails if any is not pending. Returns resolvedCount.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'accept_tracker_suggestions', clientId: extra.authInfo?.clientId });

      const result = await resolveTrackerSuggestions({
        userId,
        trackerId: args.trackerId,
        suggestionIds: args.suggestionIds,
        action: 'accept',
      });

      return jsonContent({ data: result });
    },
  );
}
