import { recordId } from '@common/lib/zod/custom-types';
import { serializeTrackerSpendingStats, serializeTrackerStats } from '@root/serializers';
import { getTrackerSpendingStats } from '@services/trackers/spending-stats';
import { getTrackerStats } from '@services/trackers/stats';

import { defineTool } from '../define-tool';

export const getTrackerSpendingStatsTool = defineTool({
  name: 'get_tracker_spending_stats',
  toolset: 'trackers',
  access: 'read',
  description:
    'Get spending statistics for a tracker: spending broken down by category and a time-series of expense vs income over the tracker period. Granularity is daily for ranges ≤62 days, weekly ≤184 days, monthly otherwise. Also returns spending by original currency, the top 5 payees, the biggest spending day, a summary (income, expense, balance, limit utilization %), per-line spent (`lines: [{ lineId, spent }]`, match lineId against get_trackers lines) and `otherSpent` for spending that matches no line. Amounts are decimals.',
  input: {
    trackerId: recordId().describe('ID of the tracker to retrieve spending stats for'),
  },
  run: async ({ userId, args }) => {
    const [spendingStats, stats] = await Promise.all([
      getTrackerSpendingStats({ userId, trackerId: args.trackerId }),
      getTrackerStats({ userId, trackerId: args.trackerId }),
    ]);

    return { ...serializeTrackerSpendingStats(spendingStats), ...serializeTrackerStats(stats) };
  },
});
