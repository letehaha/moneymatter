import { recordId } from '@common/lib/zod/custom-types';
import { unlinkTransaction } from '@services/subscriptions/unlink-transaction';

import { defineTool } from '../define-tool';

export const unlinkSubscriptionPeriodTransactionTool = defineTool({
  name: 'unlink_subscription_period_transaction',
  toolset: 'subscriptions',
  access: 'write',
  description:
    'Detach the transaction a period points at: the transaction is kept (even one the app created for the period) and the period keeps its paid status, but it no longer points at any payment, so a later revert deletes nothing. To undo the payment itself, use revert_subscription_period. Returns the period.',
  input: {
    subscriptionId: recordId().describe('ID of the subscription'),
    periodId: recordId().describe('ID of the paid period whose transaction link to clear'),
  },
  run: ({ userId, args }) =>
    unlinkTransaction({
      userId,
      subscriptionId: args.subscriptionId,
      periodId: args.periodId,
    }),
});
