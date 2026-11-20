import { SUBSCRIPTION_TYPES } from '@bt/shared/types';
import { getUpcomingPayments } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getUpcomingSubscriptionPaymentsTool = defineTool({
  name: 'get_upcoming_subscription_payments',
  toolset: 'subscriptions',
  access: 'read',
  description:
    'List upcoming subscription payments sorted by next expected payment date (soonest first). Returns subscription name, expected amount, currency, next payment date, and category. Only active subscriptions with an expectedAmount are included.',
  input: {
    limit: z.number().optional().describe('Maximum number of upcoming payments to return. Default: 5'),
    type: z
      .enum([SUBSCRIPTION_TYPES.subscription, SUBSCRIPTION_TYPES.bill, SUBSCRIPTION_TYPES.installment])
      .optional()
      .describe('Filter by type: "subscription", "bill", or "installment"'),
  },
  run: ({ userId, args }) => getUpcomingPayments({ userId, limit: args.limit, type: args.type }),
});
