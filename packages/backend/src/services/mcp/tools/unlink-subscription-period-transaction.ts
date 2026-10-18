import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { unlinkTransaction } from '@services/subscriptions/unlink-transaction';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  subscriptionId: recordId().describe('ID of the subscription'),
  periodId: recordId().describe('ID of the paid period whose transaction link to clear'),
};

export function registerUnlinkSubscriptionPeriodTransaction(server: McpServer) {
  server.registerTool(
    'unlink_subscription_period_transaction',
    {
      description:
        'Detach the transaction a period points at: the transaction is kept (even one the app created for the period) and the period keeps its paid status, but it no longer points at any payment, so a later revert deletes nothing. To undo the payment itself, use revert_subscription_period. Returns the period. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({
        userId,
        tool: 'unlink_subscription_period_transaction',
        clientId: extra.authInfo?.clientId,
      });

      const result = await unlinkTransaction({
        userId,
        subscriptionId: args.subscriptionId,
        periodId: args.periodId,
      });

      return jsonContent({ data: result });
    },
  );
}
