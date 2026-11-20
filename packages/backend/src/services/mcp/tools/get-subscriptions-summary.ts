import { SUBSCRIPTION_TYPES } from '@bt/shared/types';
import { getSubscriptionsSummary } from '@services/subscriptions';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getSubscriptionsSummaryTool = defineTool({
  name: 'get_subscriptions_summary',
  toolset: 'subscriptions',
  access: 'read',
  description:
    'Aggregate summary across all active subscriptions with an expected amount, split by direction. Returns estimated monthly cost and projected yearly cost from expense subscriptions, expected monthly income from income subscriptions, active counts as { expense, income }, the user\'s average monthly income over the last 6 complete months (observed from transaction history, separate from subscription-based expected income), and percent of that income spent on subscriptions (all monetary values in the user base currency). Useful for "how much am I spending on subscriptions per month?", "how much recurring income do I have?", or "what share of my income goes to subscriptions?"',
  input: {
    type: z
      .enum([SUBSCRIPTION_TYPES.subscription, SUBSCRIPTION_TYPES.bill, SUBSCRIPTION_TYPES.installment])
      .optional()
      .describe('Limit the summary to a specific type: "subscription", "bill", or "installment"'),
  },
  run: ({ userId, args }) => getSubscriptionsSummary({ userId, type: args.type }),
});
