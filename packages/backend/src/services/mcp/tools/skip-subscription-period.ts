import { recordId } from '@common/lib/zod/custom-types';
import { skipPeriod } from '@services/subscriptions/skip-period';

import { defineTool } from '../define-tool';

export const skipSubscriptionPeriodTool = defineTool({
  name: 'skip_subscription_period',
  toolset: 'subscriptions',
  access: 'write',
  description:
    'Skip a subscription period, for a billing cycle that is not paid, and open the next one. A paid period cannot be skipped (revert it first) and a skipped one is already skipped. Undo with revert_subscription_period. Returns the period.',
  input: {
    subscriptionId: recordId().describe('ID of the subscription'),
    periodId: recordId().describe('ID of the upcoming or overdue period to skip'),
  },
  run: ({ userId, args }) =>
    skipPeriod({
      userId,
      subscriptionId: args.subscriptionId,
      periodId: args.periodId,
    }),
});
