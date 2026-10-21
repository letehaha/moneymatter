import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { skipPeriod } from '@services/subscriptions/skip-period';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  subscriptionId: recordId().describe('ID of the subscription'),
  periodId: recordId().describe('ID of the upcoming or overdue period to skip'),
};

export function registerSkipSubscriptionPeriod(server: McpServer) {
  server.registerTool(
    'skip_subscription_period',
    {
      description:
        'Skip a subscription period, for a billing cycle that is not paid, and open the next one. A paid period cannot be skipped (revert it first) and a skipped one is already skipped. Undo with revert_subscription_period. Returns the period. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'skip_subscription_period', clientId: extra.authInfo?.clientId });

      const result = await skipPeriod({
        userId,
        subscriptionId: args.subscriptionId,
        periodId: args.periodId,
      });

      return jsonContent({ data: result });
    },
  );
}
