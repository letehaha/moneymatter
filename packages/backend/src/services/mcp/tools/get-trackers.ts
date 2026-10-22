import { TRACKER_STATUSES } from '@bt/shared/types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTrackers } from '@root/serializers/trackers.serializer';
import { getTrackers } from '@services/trackers/get-trackers';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  status: z
    .enum([TRACKER_STATUSES.active, TRACKER_STATUSES.archived, TRACKER_STATUSES.closed])
    .optional()
    .describe('Filter by tracker status. Default: active'),
};

export function registerGetTrackers(server: McpServer) {
  server.registerTool(
    'get_trackers',
    {
      description:
        'List trackers: spending watchers over a date range with an optional limit, holding hand-picked transactions plus those their category and tag rules link. They are not the period-based Budget plan (lines, assigned amounts, Ready to Assign), which no tool exposes. Filter by status (active, archived, closed). Returns tracker name, limit amount, status, date range, rule categories and tags, rulesEnabled (rules auto-link matching transactions of the owner), rulesCleanup (rule links that stop matching are removed), and lines: named category sets with their own optional limit (name, limitAmount as decimal, position, categories). A transaction lands in at most one line, the first by position whose categories (expanded to children) contain it; unmatched spending is "other". Per-line spent is in get_tracker_spending_stats. Smart tracking fields (owner-only): aiEnabled, aiDescription (what the AI looks for), aiPreWindowDays (days before startDate also scanned), aiLastScannedAt; its suggestions are in list_tracker_suggestions.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_trackers', clientId: extra.authInfo?.clientId });
      const statuses: TRACKER_STATUSES[] = args.status ? [args.status] : [TRACKER_STATUSES.active];

      const trackers = await getTrackers({
        userId,
        statuses,
      });

      return jsonContent({ data: serializeTrackers(trackers) });
    },
  );
}
