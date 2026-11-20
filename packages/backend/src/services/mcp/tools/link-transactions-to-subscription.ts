import { SUBSCRIPTION_MATCH_SOURCE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { linkTransactionsToSubscription } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const linkTransactionsToSubscriptionTool = defineTool({
  name: 'link_transactions_to_subscription',
  toolset: 'subscriptions',
  access: 'write',
  description:
    'Link one or more transactions to a subscription to mark them as payment instances. Use matchSource="manual" for user-initiated linking. If the subscription has a categoryId and matchSource="rule", the category is applied to the transactions automatically.',
  input: {
    subscriptionId: recordId().describe('UUID of the subscription'),
    transactionIds: z.array(recordId()).describe('IDs of transactions to link to the subscription'),
    matchSource: z
      .enum([SUBSCRIPTION_MATCH_SOURCE.manual, SUBSCRIPTION_MATCH_SOURCE.rule, SUBSCRIPTION_MATCH_SOURCE.ai])
      .describe('How the match was determined: manual, rule, or ai'),
  },
  run: ({ userId, args }) =>
    linkTransactionsToSubscription({
      subscriptionId: args.subscriptionId,
      transactionIds: args.transactionIds,
      userId,
      matchSource: args.matchSource,
    }),
});
