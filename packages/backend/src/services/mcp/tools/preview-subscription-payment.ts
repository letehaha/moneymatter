import { recordId } from '@common/lib/zod/custom-types';
import { getSubscriptionPayPreview } from '@services/subscriptions/get-pay-preview';

import { defineTool } from '../define-tool';

export const previewSubscriptionPaymentTool = defineTool({
  name: 'preview_subscription_payment',
  toolset: 'subscriptions',
  access: 'read',
  description:
    'Preview what paying a subscription period would book: the amount in the account’s currency (converted at today’s rate when the subscription is billed in another currency), and, with periodId, the transactions already linked to the subscription that fall inside the period and could be linked instead of creating a new one. Changes nothing. Pay with pay_subscription_period.',
  input: {
    subscriptionId: recordId().describe('ID of the subscription'),
    periodId: recordId()
      .optional()
      .describe(
        'ID of the period to pay. Give it to also get the already-recorded payments that fall inside the period',
      ),
  },
  run: ({ userId, args }) =>
    getSubscriptionPayPreview({
      userId,
      subscriptionId: args.subscriptionId,
      periodId: args.periodId,
    }),
});
