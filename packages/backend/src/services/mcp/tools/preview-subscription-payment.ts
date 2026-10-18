import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSubscriptionPayPreview } from '@services/subscriptions/get-pay-preview';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  subscriptionId: recordId().describe('ID of the subscription'),
  periodId: recordId()
    .optional()
    .describe('ID of the period to pay. Give it to also get the already-recorded payments that fall inside the period'),
};

export function registerPreviewSubscriptionPayment(server: McpServer) {
  server.registerTool(
    'preview_subscription_payment',
    {
      description:
        'Preview what paying a subscription period would book: the amount in the account’s currency (converted at today’s rate when the subscription is billed in another currency), and, with periodId, the transactions already linked to the subscription that fall inside the period and could be linked instead of creating a new one. Changes nothing. Pay with pay_subscription_period.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'preview_subscription_payment', clientId: extra.authInfo?.clientId });

      const result = await getSubscriptionPayPreview({
        userId,
        subscriptionId: args.subscriptionId,
        periodId: args.periodId,
      });

      return jsonContent({ data: result });
    },
  );
}
