import { recordId } from '@common/lib/zod/custom-types';
import { unlinkTransactionsFromSubscription } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const unlinkTransactionsFromSubscriptionTool = defineTool({
  name: 'unlink_transactions_from_subscription',
  toolset: 'subscriptions',
  access: 'write',
  description:
    'Unlink transactions from a subscription without deleting them. The link record is marked as unlinked and excluded from subscription history.',
  input: {
    subscriptionId: z.string().describe('UUID of the subscription'),
    transactionIds: z.array(recordId()).describe('IDs of transactions to unlink from the subscription'),
  },
  run: ({ userId, args }) =>
    unlinkTransactionsFromSubscription({
      subscriptionId: args.subscriptionId,
      transactionIds: args.transactionIds,
      userId,
    }),
});
