import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTrackerSpendingStats, serializeTrackerStats } from '@root/serializers';
import { getTrackerSpendingStats } from '@services/trackers/spending-stats';
import { getTrackerStats } from '@services/trackers/stats';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker to retrieve spending stats for'),
};

export function registerGetTrackerSpendingStats(server: McpServer) {
  server.registerTool(
    'get_tracker_spending_stats',
    {
      description:
        'Get spending statistics for a tracker: spending broken down by category and a time-series of expense vs income over the tracker period. Granularity is daily for ranges ≤62 days, weekly ≤184 days, monthly otherwise. Also returns spending by original currency, the top 5 payees, the biggest spending day, a summary (income, expense, balance, limit utilization %), per-line spent (`lines: [{ lineId, spent }]`, match lineId against get_trackers lines) and `otherSpent` for spending that matches no line. Amounts are decimals.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_tracker_spending_stats', clientId: extra.authInfo?.clientId });

      const [spending, trackerStats] = await Promise.all([
        getTrackerSpendingStats({ userId, trackerId: args.trackerId }),
        getTrackerStats({ userId, trackerId: args.trackerId }),
      ]);

      return jsonContent({
        data: {
          ...serializeTrackerSpendingStats({ stats: spending.stats, decimals: spending.decimals }),
          ...serializeTrackerStats({ stats: trackerStats.stats, decimals: trackerStats.decimals }),
        },
      });
    },
  );
}
