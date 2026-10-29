import { recordId } from '@common/lib/zod/custom-types';
import { getPeriodsQuerySchema } from '@controllers/subscriptions/shared-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPeriods } from '@services/subscriptions/get-periods';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  subscriptionId: recordId().describe('ID of the subscription'),
  limit: getPeriodsQuerySchema.shape.limit.describe('Periods per page, 1 to 50. Default 6'),
  offset: getPeriodsQuerySchema.shape.offset.describe('Periods to skip, for the next page. Default 0'),
};

export function registerGetSubscriptionPeriods(server: McpServer) {
  server.registerTool(
    'get_subscription_periods',
    {
      description:
        'List a subscription’s billing periods, newest due date first, with the status of each (upcoming, overdue, paid, skipped) and the transaction behind a paid one. Returns { periods, total }. Use the period ids with pay_subscription_period, skip_subscription_period, unlink_subscription_period_transaction and revert_subscription_period.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_subscription_periods', clientId: extra.authInfo?.clientId });

      const result = await getPeriods({
        userId,
        subscriptionId: args.subscriptionId,
        limit: args.limit,
        offset: args.offset,
      });

      return jsonContent({ data: result });
    },
  );
}
