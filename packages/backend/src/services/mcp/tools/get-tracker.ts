import { recordId } from '@common/lib/zod/custom-types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTracker, serializeTrackerStats } from '@root/serializers';
import { getTrackerById } from '@services/trackers/get-trackers';
import { getTrackerStats } from '@services/trackers/stats';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  trackerId: recordId().describe('ID of the tracker to read (from get_trackers)'),
};

export function registerGetTracker(server: McpServer) {
  server.registerTool(
    'get_tracker',
    {
      description:
        'Get one tracker with its progress: the tracker itself (name, status, type, date range, limit, linked categories, and the share details when it is shared with the user) and its stats (income, expense and balance over the tracker period, how much of the limit is used, how many transactions it covers, and the first and last transaction date). Amounts are decimals in the base currency of the tracker owner. For the spending split by category and the time-series use get_tracker_spending_stats; for the transactions of a category tracker use get_tracker_transactions.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_tracker', clientId: extra.authInfo?.clientId });

      const tracker = await findOrThrowNotFound({
        query: getTrackerById({ id: args.trackerId, userId }),
        message: t({ key: 'budgets.budgetNotFound' }),
      });
      const stats = await getTrackerStats({ userId, trackerId: args.trackerId });

      return jsonContent({
        data: { tracker: serializeTracker(tracker), stats: serializeTrackerStats(stats) },
      });
    },
  );
}
