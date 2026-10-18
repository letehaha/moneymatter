import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { revertPeriod } from '@services/subscriptions/revert-period';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  subscriptionId: recordId().describe('ID of the subscription'),
  periodId: recordId().describe('ID of the paid or skipped period to re-open'),
};

export function registerRevertSubscriptionPeriod(server: McpServer) {
  server.registerTool(
    'revert_subscription_period',
    {
      description:
        'Undo a paid or skipped period: it becomes upcoming (or overdue when its due date has passed) again, and the open period the app generated after it is removed unless a later period was already paid or skipped. When the payment transaction was created by the app for the period (pay_subscription_period with createTransaction), the revert also deletes that transaction and reverses its effect on the account balance, which additionally needs finance:delete scope; the call is refused, with nothing changed, when the token lacks it. A transaction you linked yourself is never deleted, and neither is one on a bank-connected account. Returns the period. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'revert_subscription_period', clientId: extra.authInfo?.clientId });

      // The service asks right before it deletes the payment transaction, inside its own
      // transaction, so the answer reflects the state the delete runs on. A revert that keeps the
      // transaction never asks, and a write-only token still works for it.
      const result = await revertPeriod({
        userId,
        subscriptionId: args.subscriptionId,
        periodId: args.periodId,
        assertCanDeleteTransaction: () => requireScope({ extra, scope: 'finance:delete' }),
      });

      return jsonContent({ data: result });
    },
  );
}
